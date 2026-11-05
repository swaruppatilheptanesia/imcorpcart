import { Prisma, VoucherCard, VoucherFulfilmentStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { getRazorpay } from '../config/razorpay';
import { AppError } from '../utils/AppError';
import { toNumber } from '../models/serializers';
import { sendVoucherEmail } from './mailer.service';
import {
  hubblePlaceOrder,
  hubbleGetOrder,
  hubbleGetOrderByReference,
  hubbleConfigured,
  HubbleApiError,
  HUBBLE_INSUFFICIENT_BALANCE,
  type HubbleOrder,
} from '../config/hubble';

// ─────────────────────────────────────────────────────────────────────────────
// Automated gift-card (Hubble voucher) fulfilment.
//
// A voucher's issuance state lives in its own table (VoucherFulfilment, 1:1 with
// the OrderItem it fulfils) — a digital voucher has a different lifecycle than a
// physical order line. A line for N cards owns N VoucherCard rows, and each card is
// its own Hubble order of quantity 1 (auto-debits the client's Hubble wallet), so
// the buyer always gets N separate cards and Hubble's per-order caps don't apply.
// Cards are placed one at a time. Issuance is async: Hubble usually returns
// PROCESSING with no code, so we poll GET /orders/:id until SUCCESS (store the code)
// or the 15-min cutoff (card FAILED). Once every card has settled the line rolls up,
// the failed cards' share is refunded and ONE email carries every issued card. All
// fire-and-forget so a Hubble outage never blocks or rolls back the paid checkout.
// Idempotent on each card's Hubble referenceId (refFor), so a retry or a post-restart
// resume never double-issues / double-debits.
//
// Everything here is keyed on the OrderItem id (the public API); the rows are looked
// up by the fulfilment's unique orderItemId. This module must NOT import shop.service
// (shop.service → this, one-way): the partial-refund uses getRazorpay() directly.
// ─────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 20_000; // between polls of a PROCESSING order
const CUTOFF_MS = 15 * 60 * 1000; // give up on a card after 15 min (Hubble's own max window)
const UNFINISHED = [VoucherFulfilmentStatus.PENDING, VoucherFulfilmentStatus.PROCESSING];

// In-flight guard so one worker runs per item (avoids duplicate place/poll loops
// from concurrent kickoff + resume, or overlapping timers).
const inFlight = new Set<string>();

type VfRow = Prisma.VoucherFulfilmentGetPayload<{
  select: {
    id: true;
    status: true;
    denomination: true;
    hubbleOrderRef: true;
    orderItem: {
      select: {
        id: true;
        quantity: true;
        lineTotal: true;
        orderId: true;
        product: { select: { externalRef: true; brand: true; name: true } };
        order: { select: { orderNo: true; createdAt: true; employee: { select: { user: { select: { email: true } } } } } };
      };
    };
  };
}>;

const vfSelect = {
  id: true,
  status: true,
  denomination: true,
  hubbleOrderRef: true,
  orderItem: {
    select: {
      id: true,
      quantity: true,
      lineTotal: true,
      orderId: true,
      product: { select: { externalRef: true, brand: true, name: true } },
      order: { select: { orderNo: true, createdAt: true, employee: { select: { user: { select: { email: true } } } } } },
    },
  },
} satisfies Prisma.VoucherFulfilmentSelect;

// Load the fulfilment for an OrderItem (the public key). Null = not a voucher line.
function loadFulfilment(orderItemId: string): Promise<VfRow | null> {
  return prisma.voucherFulfilment.findUnique({ where: { orderItemId }, select: vfSelect });
}

/** Kick off fulfilment for freshly-placed voucher lines (called post-commit from placeOrder). */
export function kickoffVoucherFulfilments(itemIds: string[]): void {
  for (const id of itemIds) {
    void fulfilItem(id).catch((e) => console.error(`[voucher] kickoff ${id} failed:`, e));
  }
}

/**
 * Re-enqueue every unfinished voucher fulfilment on boot, so a process restart
 * mid-issuance still delivers. Idempotent (Hubble referenceId dedups).
 */
export async function resumePendingFulfilments(): Promise<void> {
  if (!hubbleConfigured()) return;
  const rows = await prisma.voucherFulfilment.findMany({
    where: { status: { in: [VoucherFulfilmentStatus.PENDING, VoucherFulfilmentStatus.PROCESSING] } },
    select: { orderItemId: true },
  });
  if (rows.length) {
    console.log(`[voucher] resuming ${rows.length} pending fulfilment(s)`);
    kickoffVoucherFulfilments(rows.map((r) => r.orderItemId));
  }
}

/**
 * Deliver the gift cards the old flow lost. It bought one Hubble order for a whole
 * line and kept only its first voucher, so a buyer of 2+ cards paid for cards they
 * never saw. Runs on every boot and from prisma/recover-voucher-cards.ts: reads each
 * such order back from Hubble and, only when Hubble holds exactly the cards paid for,
 * files the missing ones and emails just those. Anything else is logged for a manual
 * decision. It NEVER buys, never logs a code or PIN, and a line holding all its cards
 * is left alone, so running it repeatedly is safe.
 */
export async function recoverMissingCards(
  opts: { apply: boolean; orderNo?: string; log?: (line: string) => void } = { apply: true },
): Promise<void> {
  if (!hubbleConfigured()) return;
  const log = opts.log ?? ((line: string) => console.log(`[voucher recovery] ${line}`));
  const lines = await prisma.voucherFulfilment.findMany({
    where: {
      status: VoucherFulfilmentStatus.DELIVERED,
      hubbleOrderRef: { not: null },
      orderItem: { quantity: { gt: 1 }, ...(opts.orderNo ? { order: { orderNo: opts.orderNo } } : {}) },
    },
    select: {
      id: true,
      denomination: true,
      hubbleOrderRef: true,
      cards: { where: { status: VoucherFulfilmentStatus.DELIVERED }, orderBy: { unitNo: 'asc' } },
      orderItem: {
        select: {
          quantity: true,
          product: { select: { brand: true, name: true } },
          order: { select: { orderNo: true, employee: { select: { user: { select: { email: true } } } } } },
        },
      },
    },
  });

  for (const line of lines) {
    const { quantity, order, product } = line.orderItem;
    const brand = product.brand || product.name;
    const denomination = toNumber(line.denomination);
    const label = `${order.orderNo} · ${brand} · ${quantity} × ₹${denomination}`;
    if (line.cards.length >= quantity) {
      log(`OK       ${label} · all ${quantity} cards on file`);
      continue;
    }

    let vouchers: NonNullable<HubbleOrder['vouchers']>;
    try {
      const hubble = await hubbleGetOrder(line.hubbleOrderRef as string);
      vouchers = hubble.vouchers ?? [];
      const amounts = vouchers.map((v) => v.amount ?? '?').join(', ') || 'none';
      log(`HUBBLE   ${label} · status ${hubble.status} · ${vouchers.length} voucher(s), amounts: ${amounts} · ${line.cards.length} on file`);
    } catch (e) {
      log(`ERROR    ${label} · ${e instanceof Error ? e.message : e}`);
      continue;
    }

    const exact = vouchers.length === quantity && vouchers.every((v) => v.amount == null || Number(v.amount) === denomination);
    if (!exact) {
      log(`DECIDE   ${label} · Hubble's vouchers don't match what was paid for. Nothing changed.`);
      continue;
    }

    const held = new Set(line.cards.map((c) => `${c.code ?? ''}|${c.pin ?? ''}`));
    const missing = vouchers.filter((v) => !held.has(`${v.cardNumber ?? ''}|${v.cardPin ?? ''}`));
    if (!opts.apply) {
      log(`RECOVER  ${label} · would file and email ${missing.length} card(s)`);
      continue;
    }

    const filed: { code?: string | null; pin?: string | null; expiry?: string | null; amount: number }[] = [];
    let unitNo = Math.max(0, ...line.cards.map((c) => c.unitNo));
    try {
      for (const v of missing) {
        unitNo += 1;
        const expiry = v.validTill ? new Date(v.validTill) : null;
        // The unique (fulfilmentId, unitNo) stops a second process filing it too.
        await prisma.voucherCard.create({
          data: {
            fulfilmentId: line.id,
            unitNo,
            status: VoucherFulfilmentStatus.DELIVERED,
            hubbleOrderRef: line.hubbleOrderRef,
            code: v.cardNumber ?? null,
            pin: v.cardPin ?? null,
            cardType: v.cardType ?? null,
            expiry: expiry && !Number.isNaN(+expiry) ? expiry : null,
            amount: v.amount ?? line.denomination,
            deliveredAt: new Date(),
          },
        });
        filed.push({ code: v.cardNumber, pin: v.cardPin, expiry: v.validTill, amount: toNumber(v.amount ?? line.denomination) });
      }
    } catch (e) {
      log(`ERROR    ${label} · could not file a card: ${e instanceof Error ? e.message : e}`);
    }
    if (!filed.length) continue;

    const email = order.employee?.user?.email;
    if (email) {
      await sendVoucherEmail(email, {
        brand,
        amount: denomination,
        cards: filed,
        orderNo: order.orderNo,
        note: `Here ${filed.length > 1 ? 'are the remaining gift cards' : 'is the remaining gift card'} from your order ${order.orderNo}. We're sorry for the delay.`,
      });
    }
    log(`DONE     ${label} · filed ${filed.length} card(s)${email ? ', emailed the buyer' : ', NO buyer email on file'}`);
  }
}

// Card 1 keeps the bare item id, so a line whose Hubble order was placed before cards
// existed is still found; the rest are suffixed (Hubble allows 40 chars, a cuid is 25).
const refFor = (itemId: string, unitNo: number) => (unitNo === 1 ? itemId : `${itemId}-${unitNo}`);

// Create the line's missing card rows. Card 1 inherits a Hubble order the old flow
// already placed, so it is polled rather than bought again.
async function ensureCards(vf: VfRow): Promise<void> {
  await prisma.voucherCard.createMany({
    data: Array.from({ length: vf.orderItem.quantity }, (_, i) => {
      const inherited = i === 0 ? vf.hubbleOrderRef : null;
      return {
        fulfilmentId: vf.id,
        unitNo: i + 1,
        hubbleOrderRef: inherited,
        status: inherited ? VoucherFulfilmentStatus.PROCESSING : VoucherFulfilmentStatus.PENDING,
      };
    }),
    skipDuplicates: true,
  });
}

// Drive a line forward: place or poll its unfinished cards, lowest first, and stop at
// the first one still issuing (a poll is scheduled to pick it back up). One at a time
// on purpose — an old-style order for the whole line fills the later cards when it
// completes, which must happen before they would be bought separately.
async function fulfilItem(itemId: string): Promise<void> {
  if (inFlight.has(itemId)) return;
  inFlight.add(itemId);
  try {
    const vf = await loadFulfilment(itemId);
    if (!vf) return; // not a voucher line
    // Terminal → nothing to do.
    if (vf.status === VoucherFulfilmentStatus.DELIVERED || vf.status === VoucherFulfilmentStatus.FAILED) {
      return;
    }

    await ensureCards(vf);
    const productId = vf.orderItem.product.externalRef;
    const denomination = toNumber(vf.denomination);
    const misconfigured = !productId || !(denomination > 0);

    for (;;) {
      const card = await prisma.voucherCard.findFirst({
        where: { fulfilmentId: vf.id, status: { in: UNFINISHED } },
        orderBy: { unitNo: 'asc' },
      });
      if (!card) break;
      if (misconfigured) {
        await failCard(card.id, 'Voucher is misconfigured (missing product reference or amount)');
        continue;
      }
      if (await advanceCard(vf, card, productId as string, denomination)) {
        schedulePoll(itemId);
        return;
      }
    }
    await settleLine(itemId);
  } finally {
    inFlight.delete(itemId);
  }
}

// Move one card along. Returns true while Hubble is still issuing it.
async function advanceCard(vf: VfRow, card: VoucherCard, productId: string, denomination: number): Promise<boolean> {
  // Already placed → just poll. A poll never writes the card, so updatedAt is when it
  // went PROCESSING.
  if (card.status === VoucherFulfilmentStatus.PROCESSING && card.hubbleOrderRef) {
    if (Date.now() - card.updatedAt.getTime() > CUTOFF_MS) {
      await failCard(card.id, 'Voucher issuance timed out');
      return false;
    }
    try {
      return await applyOrder(vf, card, await hubbleGetOrder(card.hubbleOrderRef));
    } catch (e) {
      console.error(`[voucher] poll card ${card.id} failed (will retry):`, e instanceof Error ? e.message : e);
      return true; // transient — retry until cutoff
    }
  }

  // Recover from a prior attempt that may have placed before a crash: Hubble's
  // referenceId is idempotent. 404 = safe to place fresh.
  const referenceId = refFor(vf.orderItem.id, card.unitNo);
  let order: HubbleOrder | null = null;
  try {
    order = await hubbleGetOrderByReference(referenceId);
  } catch (e) {
    if (!(e instanceof HubbleApiError && e.status === 404)) {
      // A transient lookup error — fall through to place (idempotent) rather than fail.
      console.error(`[voucher] by-reference lookup failed for ${referenceId}:`, e);
    }
  }

  if (!order) {
    try {
      order = await hubblePlaceOrder({
        productId,
        referenceId,
        amount: denomination,
        denominationDetails: [{ denomination, quantity: 1 }],
      });
    } catch (e) {
      const msg =
        e instanceof HubbleApiError && e.code === HUBBLE_INSUFFICIENT_BALANCE
          ? 'Gift-card wallet balance is insufficient — please contact support'
          : e instanceof Error
            ? e.message
            : 'Voucher order failed';
      await failCard(card.id, msg);
      return false;
    }
  }

  return applyOrder(vf, card, order);
}

// Apply a Hubble order's state to a card: file it on SUCCESS, keep polling while
// issuing, fail it on a terminal state. Returns true while Hubble is still issuing.
async function applyOrder(vf: VfRow, card: VoucherCard, order: HubbleOrder): Promise<boolean> {
  if (order.status === 'SUCCESS' && order.vouchers?.length) {
    await fileVouchers(vf, card, order);
    return false;
  }
  if (order.status === 'PROCESSING' || order.status === 'SUCCESS') {
    if (card.status !== VoucherFulfilmentStatus.PROCESSING || card.hubbleOrderRef !== order.id) {
      await prisma.voucherCard.update({
        where: { id: card.id },
        data: { status: VoucherFulfilmentStatus.PROCESSING, hubbleOrderRef: order.id },
      });
    }
    return true;
  }
  // FAILED / CANCELLED / REVERSED
  await failCard(card.id, order.failureReason || `Voucher order ${order.status.toLowerCase()}`, order.id);
  return false;
}

// Store what Hubble issued. Normally one voucher for this card; an old-style order
// placed for the whole line carries several, which fill the line's next open cards.
async function fileVouchers(vf: VfRow, card: VoucherCard, order: HubbleOrder): Promise<void> {
  const open = await prisma.voucherCard.findMany({
    where: { fulfilmentId: vf.id, status: { in: UNFINISHED }, unitNo: { gte: card.unitNo } },
    orderBy: { unitNo: 'asc' },
  });
  const vouchers = order.vouchers ?? [];
  for (let i = 0; i < Math.min(open.length, vouchers.length); i++) {
    const v = vouchers[i];
    const expiry = v.validTill ? new Date(v.validTill) : null;
    await prisma.voucherCard.update({
      where: { id: open[i].id },
      data: {
        status: VoucherFulfilmentStatus.DELIVERED,
        hubbleOrderRef: order.id,
        code: v.cardNumber ?? null,
        pin: v.cardPin ?? null,
        cardType: v.cardType ?? null,
        expiry: expiry && !Number.isNaN(+expiry) ? expiry : null,
        amount: v.amount ?? vf.denomination,
        error: null,
        deliveredAt: new Date(),
      },
    });
  }
}

async function failCard(cardId: string, reason: string, hubbleOrderRef?: string): Promise<void> {
  await prisma.voucherCard.update({
    where: { id: cardId },
    data: { status: VoucherFulfilmentStatus.FAILED, error: reason.slice(0, 500), ...(hubbleOrderRef ? { hubbleOrderRef } : {}) },
  });
  console.error(`[voucher] card ${cardId} FAILED: ${reason}`);
}

function schedulePoll(itemId: string): void {
  setTimeout(() => {
    void fulfilItem(itemId).catch((e) => console.error(`[voucher] scheduled poll ${itemId} failed:`, e));
  }, POLL_INTERVAL_MS).unref?.();
}

type EmailCard = Pick<VoucherCard, 'code' | 'pin' | 'expiry' | 'amount'>;
const toEmailCard = (c: EmailCard) => ({
  code: c.code,
  pin: c.pin,
  expiry: c.expiry ? c.expiry.toISOString().slice(0, 10) : null,
  amount: toNumber(c.amount),
});

// Every card has settled: roll the line up, refund what failed and send the one email.
// The conditional update makes this happen once, however many workers reach it.
async function settleLine(itemId: string): Promise<void> {
  const vf = await loadFulfilment(itemId);
  if (!vf) return;
  const cards = await prisma.voucherCard.findMany({ where: { fulfilmentId: vf.id }, orderBy: { unitNo: 'asc' } });
  const issued = cards.filter((c) => c.status === VoucherFulfilmentStatus.DELIVERED);
  const failed = cards.filter((c) => c.status === VoucherFulfilmentStatus.FAILED);
  const reason = failed[0]?.error ?? null;

  const settled = await prisma.voucherFulfilment.updateMany({
    where: { orderItemId: itemId, status: { in: UNFINISHED } },
    data: {
      status: issued.length ? VoucherFulfilmentStatus.DELIVERED : VoucherFulfilmentStatus.FAILED,
      fulfilmentError: failed.length
        ? `${failed.length} of ${cards.length} could not be issued: ${reason}`.slice(0, 500)
        : null,
      deliveredAt: issued.length ? new Date() : null,
    },
  });
  if (settled.count === 0) return;

  const brand = vf.orderItem.product.brand || vf.orderItem.product.name;
  const refunded = failed.length ? await refundFailedCards(vf) : null;
  if (failed.length) {
    await noteOnOrder(vf, brand, issued.length, cards.length, reason, refunded);
  }

  const email = vf.orderItem.order.employee?.user?.email;
  if (email && issued.length) {
    await sendVoucherEmail(email, {
      brand,
      amount: toNumber(vf.denomination),
      cards: issued.map(toEmailCard),
      orderNo: vf.orderItem.order.orderNo,
      note: failed.length
        ? `${failed.length} of the ${cards.length} gift cards you ordered could not be issued.${refunded ? ` ${rupeesText(refunded)} has been refunded.` : ''}`
        : null,
    });
  }
  console.log(`[voucher] settled ${itemId}: ${issued.length} of ${cards.length} issued (order ${vf.orderItem.order.orderNo})`);
}

const rupeesText = (n: number) => `₹${n.toLocaleString('en-IN')}`;

// Admin action: re-send every issued card of a line to the buyer (support: lost
// codes). Reads the stored credentials server-side and re-uses sendVoucherEmail — the
// raw codes are never returned to the caller. Only works once DELIVERED.
export async function resendVoucherEmail(itemId: string): Promise<void> {
  const vf = await prisma.voucherFulfilment.findUnique({
    where: { orderItemId: itemId },
    select: {
      status: true,
      denomination: true,
      cards: {
        where: { status: VoucherFulfilmentStatus.DELIVERED },
        orderBy: { unitNo: 'asc' },
        select: { code: true, pin: true, expiry: true, amount: true },
      },
      orderItem: {
        select: {
          product: { select: { brand: true, name: true } },
          order: { select: { orderNo: true, employee: { select: { user: { select: { email: true } } } } } },
        },
      },
    },
  });
  if (!vf || vf.status !== VoucherFulfilmentStatus.DELIVERED || !vf.cards.length) {
    throw AppError.badRequest('No delivered voucher to resend for this item');
  }
  const email = vf.orderItem.order.employee?.user?.email;
  if (!email) throw AppError.badRequest('This buyer has no email on file');
  await sendVoucherEmail(email, {
    brand: vf.orderItem.product.brand || vf.orderItem.product.name,
    amount: toNumber(vf.denomination),
    cards: vf.cards.map(toEmailCard),
    orderNo: vf.orderItem.order.orderNo,
  });
}

// Partial-refund the failed cards' share against the order's captured Razorpay
// payment, so the buyer is never charged for a voucher we couldn't issue. Each card is
// stamped first so it can't be refunded twice. Returns the amount refunded: null when
// nothing was newly due, 0 when the refund did not go through.
async function refundFailedCards(vf: VfRow): Promise<number | null> {
  const stamp = new Date();
  const claimed = await prisma.voucherCard.updateMany({
    where: { fulfilmentId: vf.id, status: VoucherFulfilmentStatus.FAILED, refundedAt: null },
    data: { refundedAt: stamp },
  });
  if (claimed.count === 0) return null;

  const share = toNumber(vf.orderItem.lineTotal) / vf.orderItem.quantity;
  const amount = Math.round(share * claimed.count * 100) / 100;
  try {
    const payment = await prisma.payment.findFirst({
      where: { orderId: vf.orderItem.orderId, gateway: 'RAZORPAY', status: 'CAPTURED', gatewayTxnId: { not: null } },
      select: { gatewayTxnId: true },
    });
    if (!payment?.gatewayTxnId || !(amount > 0)) throw new Error('No captured payment to refund');
    await getRazorpay().payments.refund(payment.gatewayTxnId, { amount: Math.round(amount * 100) });
    return amount;
  } catch (e) {
    console.error(`[voucher] refund failed for item ${vf.orderItem.id}:`, e instanceof Error ? e.message : e);
    await prisma.voucherCard.updateMany({
      where: { fulfilmentId: vf.id, refundedAt: stamp },
      data: { refundedAt: null },
    });
    return 0;
  }
}

// Audit note on the order (visible in the admin timeline) — best-effort.
async function noteOnOrder(
  vf: VfRow,
  brand: string,
  issued: number,
  total: number,
  reason: string | null,
  refunded: number | null,
): Promise<void> {
  const money =
    refunded === null ? '' : refunded > 0 ? ` Buyer refunded ${rupeesText(refunded)}.` : ' The refund did not go through, please refund by hand.';
  try {
    await prisma.orderStatusHistory.create({
      data: {
        orderId: vf.orderItem.orderId,
        status: 'PLACED',
        note: `Gift card "${brand}": ${issued} of ${total} issued (${reason}).${money}`,
      },
    });
  } catch {
    /* non-fatal */
  }
}

/**
 * Admin action: retry a stuck/failed voucher issuance. Resets to PENDING (or keeps
 * PROCESSING) and re-runs. Safe — idempotent on the Hubble referenceId.
 */
export async function retryVoucherFulfilment(itemId: string): Promise<void> {
  const vf = await prisma.voucherFulfilment.findUnique({
    where: { orderItemId: itemId },
    select: { id: true, status: true },
  });
  if (!vf) return; // not a voucher line
  if (vf.status === VoucherFulfilmentStatus.FAILED) {
    await prisma.voucherCard.updateMany({
      where: { fulfilmentId: vf.id, status: VoucherFulfilmentStatus.FAILED },
      data: { status: VoucherFulfilmentStatus.PENDING, error: null },
    });
    await prisma.voucherFulfilment.update({
      where: { orderItemId: itemId },
      data: { status: VoucherFulfilmentStatus.PENDING, fulfilmentError: null },
    });
  }
  await fulfilItem(itemId);
}
