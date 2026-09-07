import { Prisma, VoucherFulfilmentStatus } from '@prisma/client';
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
// physical order line. After the line is PAID (its VoucherFulfilment starts
// PENDING), we place a Hubble order (auto-debits the client's Hubble wallet).
// Issuance is async: Hubble usually returns PROCESSING with no code, so we poll
// GET /orders/:id until SUCCESS (store the code, email + reveal it in-app) or the
// 15-min cutoff (FAILED → refund the buyer). All fire-and-forget so a Hubble
// outage never blocks or rolls back the paid checkout. Idempotent on the
// OrderItem id (Hubble's referenceId), so a retry or a post-restart resume never
// double-issues / double-debits.
//
// Everything here is keyed on the OrderItem id (the public API + the Hubble
// referenceId); the VoucherFulfilment row is looked up by its unique orderItemId.
// This module must NOT import shop.service (shop.service → this, one-way): the
// partial-refund uses getRazorpay() directly.
// ─────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 20_000; // between polls of a PROCESSING order
const CUTOFF_MS = 15 * 60 * 1000; // give up after 15 min (Hubble's own max window)

// In-flight guard so one worker runs per item (avoids duplicate place/poll loops
// from concurrent kickoff + resume, or overlapping timers).
const inFlight = new Set<string>();

type VfRow = Prisma.VoucherFulfilmentGetPayload<{
  select: {
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

// Place the Hubble order (or recover an existing one) for a PENDING/PROCESSING item.
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

    // Already placed (PROCESSING with a Hubble order) → just poll.
    if (vf.status === VoucherFulfilmentStatus.PROCESSING && vf.hubbleOrderRef) {
      await pollOnce(itemId);
      return;
    }

    const productId = vf.orderItem.product.externalRef;
    const denomination = toNumber(vf.denomination);
    if (!productId || !(denomination > 0)) {
      await markFailed(itemId, 'Voucher is misconfigured (missing product reference or amount)');
      return;
    }

    // Recover from a prior attempt that may have placed before a crash: Hubble's
    // referenceId (= our OrderItem id) is idempotent. 404 = safe to place fresh.
    let order: HubbleOrder | null = null;
    try {
      order = await hubbleGetOrderByReference(itemId);
    } catch (e) {
      if (!(e instanceof HubbleApiError && e.status === 404)) {
        // A transient lookup error — fall through to place (idempotent) rather than fail.
        console.error(`[voucher] by-reference lookup failed for ${itemId}:`, e);
      }
    }

    if (!order) {
      try {
        order = await hubblePlaceOrder({
          productId,
          referenceId: itemId,
          amount: denomination * vf.orderItem.quantity,
          denominationDetails: [{ denomination, quantity: vf.orderItem.quantity }],
        });
      } catch (e) {
        const msg =
          e instanceof HubbleApiError && e.code === HUBBLE_INSUFFICIENT_BALANCE
            ? 'Gift-card wallet balance is insufficient — please contact support'
            : e instanceof Error
              ? e.message
              : 'Voucher order failed';
        await markFailed(itemId, msg);
        return;
      }
    }

    await handleOrderState(itemId, order);
  } finally {
    inFlight.delete(itemId);
  }
}

// Apply a Hubble order's state to our fulfilment: deliver on SUCCESS, poll on
// PROCESSING, refund on a terminal failure.
async function handleOrderState(itemId: string, order: HubbleOrder): Promise<void> {
  await prisma.voucherFulfilment.update({ where: { orderItemId: itemId }, data: { hubbleOrderRef: order.id } });

  const voucher = order.vouchers?.[0];
  if (order.status === 'SUCCESS' && voucher) {
    await deliver(itemId, order);
    return;
  }
  if (order.status === 'PROCESSING' || (order.status === 'SUCCESS' && !voucher)) {
    await prisma.voucherFulfilment.update({
      where: { orderItemId: itemId },
      data: { status: VoucherFulfilmentStatus.PROCESSING },
    });
    schedulePoll(itemId);
    return;
  }
  // FAILED / CANCELLED / REVERSED
  await markFailed(itemId, order.failureReason || `Voucher order ${order.status.toLowerCase()}`);
}

// Store the issued credential, mark DELIVERED, email it (best-effort; also shown in-app).
async function deliver(itemId: string, order: HubbleOrder): Promise<void> {
  const voucher = order.vouchers?.[0];
  if (!voucher) return;
  const vf = await loadFulfilment(itemId);
  if (!vf || vf.status === VoucherFulfilmentStatus.DELIVERED) return;

  const expiry = voucher.validTill ? new Date(voucher.validTill) : null;
  await prisma.voucherFulfilment.update({
    where: { orderItemId: itemId },
    data: {
      status: VoucherFulfilmentStatus.DELIVERED,
      hubbleOrderRef: order.id,
      voucherCode: voucher.cardNumber ?? null,
      voucherPin: voucher.cardPin ?? null,
      voucherCardType: voucher.cardType ?? null,
      voucherExpiry: expiry && !Number.isNaN(+expiry) ? expiry : null,
      fulfilmentError: null,
      deliveredAt: new Date(),
    },
  });

  const email = vf.orderItem.order.employee?.user?.email;
  if (email) {
    await sendVoucherEmail(email, {
      brand: vf.orderItem.product.brand || vf.orderItem.product.name,
      amount: toNumber(vf.denomination),
      code: voucher.cardNumber,
      pin: voucher.cardPin,
      cardType: voucher.cardType,
      expiry: voucher.validTill,
      orderNo: vf.orderItem.order.orderNo,
    });
  }
  console.log(`[voucher] delivered ${itemId} (order ${vf.orderItem.order.orderNo})`);
}

// Admin action: re-send an already-issued voucher email to the buyer (support: a
// lost code). Reads the stored credential server-side and re-uses sendVoucherEmail
// — the raw code is never returned to the caller. Only works once DELIVERED.
export async function resendVoucherEmail(itemId: string): Promise<void> {
  const vf = await prisma.voucherFulfilment.findUnique({
    where: { orderItemId: itemId },
    select: {
      status: true,
      denomination: true,
      voucherCode: true,
      voucherPin: true,
      voucherCardType: true,
      voucherExpiry: true,
      orderItem: {
        select: {
          product: { select: { brand: true, name: true } },
          order: { select: { orderNo: true, employee: { select: { user: { select: { email: true } } } } } },
        },
      },
    },
  });
  if (!vf || vf.status !== VoucherFulfilmentStatus.DELIVERED || !vf.voucherCode) {
    throw AppError.badRequest('No delivered voucher to resend for this item');
  }
  const email = vf.orderItem.order.employee?.user?.email;
  if (!email) throw AppError.badRequest('This buyer has no email on file');
  await sendVoucherEmail(email, {
    brand: vf.orderItem.product.brand || vf.orderItem.product.name,
    amount: toNumber(vf.denomination),
    code: vf.voucherCode,
    pin: vf.voucherPin,
    cardType: vf.voucherCardType,
    expiry: vf.voucherExpiry ? vf.voucherExpiry.toISOString().slice(0, 10) : null,
    orderNo: vf.orderItem.order.orderNo,
  });
}

// Poll a PROCESSING order once; deliver / fail / reschedule based on the result.
async function pollOnce(itemId: string): Promise<void> {
  const vf = await loadFulfilment(itemId);
  if (!vf || vf.status !== VoucherFulfilmentStatus.PROCESSING || !vf.hubbleOrderRef) return;

  if (Date.now() - vf.orderItem.order.createdAt.getTime() > CUTOFF_MS) {
    await markFailed(itemId, 'Voucher issuance timed out');
    return;
  }

  let order: HubbleOrder;
  try {
    order = await hubbleGetOrder(vf.hubbleOrderRef);
  } catch (e) {
    console.error(`[voucher] poll ${itemId} failed (will retry):`, e instanceof Error ? e.message : e);
    schedulePoll(itemId); // transient — retry until cutoff
    return;
  }

  const voucher = order.vouchers?.[0];
  if (order.status === 'SUCCESS' && voucher) {
    await deliver(itemId, order);
  } else if (order.status === 'PROCESSING' || (order.status === 'SUCCESS' && !voucher)) {
    schedulePoll(itemId);
  } else {
    await markFailed(itemId, order.failureReason || `Voucher order ${order.status.toLowerCase()}`);
  }
}

function schedulePoll(itemId: string): void {
  setTimeout(() => {
    void pollOnce(itemId).catch((e) => console.error(`[voucher] scheduled poll ${itemId} failed:`, e));
  }, POLL_INTERVAL_MS).unref?.();
}

// Mark FAILED, refund the buyer's line (best-effort), and leave an audit note on the
// order so the admin sees it. Hubble auto-reverses its own wallet on a FAILED order.
async function markFailed(itemId: string, reason: string): Promise<void> {
  const vf = await loadFulfilment(itemId);
  if (!vf || vf.status === VoucherFulfilmentStatus.FAILED) return;
  await prisma.voucherFulfilment.update({
    where: { orderItemId: itemId },
    data: { status: VoucherFulfilmentStatus.FAILED, fulfilmentError: reason.slice(0, 500) },
  });
  console.error(`[voucher] FAILED ${itemId} (order ${vf.orderItem.order.orderNo}): ${reason}`);
  await refundLine(vf, reason);
}

// Partial-refund the failed voucher line against its order's captured Razorpay
// payment, so the buyer is never charged for a voucher we couldn't issue.
async function refundLine(vf: VfRow, reason: string): Promise<void> {
  const amount = toNumber(vf.orderItem.lineTotal);
  try {
    const payment = await prisma.payment.findFirst({
      where: { orderId: vf.orderItem.orderId, gateway: 'RAZORPAY', status: 'CAPTURED', gatewayTxnId: { not: null } },
      select: { gatewayTxnId: true },
    });
    if (payment?.gatewayTxnId && amount > 0) {
      await getRazorpay().payments.refund(payment.gatewayTxnId, { amount: Math.round(amount * 100) });
    }
  } catch (e) {
    console.error(`[voucher] refund failed for item ${vf.orderItem.id}:`, e instanceof Error ? e.message : e);
  }
  // Audit note on the order (visible in the admin timeline) — best-effort.
  try {
    await prisma.orderStatusHistory.create({
      data: {
        orderId: vf.orderItem.orderId,
        status: 'PLACED',
        note: `Gift card "${vf.orderItem.product.brand || vf.orderItem.product.name}" could not be issued (${reason}). Buyer refunded ₹${amount}.`,
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
  const vf = await prisma.voucherFulfilment.findUnique({ where: { orderItemId: itemId }, select: { status: true } });
  if (!vf) return; // not a voucher line
  if (vf.status === VoucherFulfilmentStatus.FAILED) {
    await prisma.voucherFulfilment.update({
      where: { orderItemId: itemId },
      data: { status: VoucherFulfilmentStatus.PENDING, fulfilmentError: null },
    });
  }
  await fulfilItem(itemId);
}
