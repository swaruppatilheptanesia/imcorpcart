// Recover gift cards the old flow failed to deliver.
//
// Until each card became its own Hubble order, a line for 2+ cards placed one Hubble
// order and kept only its first voucher, so the buyer paid for cards they never saw.
// This reads each such order back from Hubble and reports what it holds. It NEVER
// buys anything, and never prints a card number or PIN.
//
//   Dry run:  npx ts-node prisma/recover-voucher-cards.ts [--order=IMC-75804326]
//   Apply:    npx ts-node prisma/recover-voucher-cards.ts --apply [--order=IMC-75804326]
//
// --apply files the missing cards and emails only those. It acts only when Hubble
// holds exactly the cards paid for; anything else is left for a manual decision.
// Re-running is safe: a line already holding all its cards is reported as OK.
// Run from the production server: Hubble only accepts whitelisted IPs.

import { PrismaClient, VoucherFulfilmentStatus } from '@prisma/client';
import { hubbleGetOrder } from '../src/config/hubble';
import { sendVoucherEmail } from '../src/services/mailer.service';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const orderNo = process.argv.find((a) => a.startsWith('--order='))?.slice('--order='.length);

async function main() {
  const lines = await prisma.voucherFulfilment.findMany({
    where: {
      status: VoucherFulfilmentStatus.DELIVERED,
      hubbleOrderRef: { not: null },
      orderItem: { quantity: { gt: 1 }, ...(orderNo ? { order: { orderNo } } : {}) },
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
  console.log(`${lines.length} delivered line(s) with quantity above 1 from a single Hubble order. ${apply ? 'APPLY' : 'Dry run'}.\n`);

  for (const line of lines) {
    const { quantity, order, product } = line.orderItem;
    const denomination = Number(line.denomination);
    const label = `${order.orderNo} · ${product.brand || product.name} · ${quantity} × ₹${denomination}`;
    if (line.cards.length >= quantity) {
      console.log(`OK       ${label} · all ${quantity} cards on file`);
      continue;
    }

    let vouchers;
    try {
      const hubble = await hubbleGetOrder(line.hubbleOrderRef as string);
      vouchers = hubble.vouchers ?? [];
      const amounts = vouchers.map((v) => v.amount ?? '?').join(', ') || 'none';
      console.log(`HUBBLE   ${label} · status ${hubble.status} · ${vouchers.length} voucher(s), amounts: ${amounts} · ${line.cards.length} on file`);
    } catch (e) {
      console.log(`ERROR    ${label} · ${e instanceof Error ? e.message : e}`);
      continue;
    }

    const exact = vouchers.length === quantity && vouchers.every((v) => v.amount == null || Number(v.amount) === denomination);
    if (!exact) {
      console.log(`DECIDE   ${label} · Hubble's vouchers don't match what was paid for. Nothing changed.`);
      continue;
    }

    const held = new Set(line.cards.map((c) => `${c.code ?? ''}|${c.pin ?? ''}`));
    const missing = vouchers.filter((v) => !held.has(`${v.cardNumber ?? ''}|${v.cardPin ?? ''}`));
    if (!apply) {
      console.log(`RECOVER  ${label} · would file and email ${missing.length} card(s)`);
      continue;
    }

    const emailCards = [];
    let unitNo = Math.max(0, ...line.cards.map((c) => c.unitNo));
    for (const v of missing) {
      unitNo += 1;
      const expiry = v.validTill ? new Date(v.validTill) : null;
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
      emailCards.push({ code: v.cardNumber, pin: v.cardPin, expiry: v.validTill, amount: v.amount ?? denomination });
    }

    const email = order.employee?.user?.email;
    if (email) {
      await sendVoucherEmail(email, {
        brand: product.brand || product.name,
        amount: denomination,
        cards: emailCards,
        orderNo: order.orderNo,
        note: `Here ${emailCards.length > 1 ? 'are the remaining gift cards' : 'is the remaining gift card'} from your order ${order.orderNo}. We're sorry for the delay.`,
      });
    }
    console.log(`DONE     ${label} · filed ${emailCards.length} card(s)${email ? ', emailed the buyer' : ', NO buyer email on file'}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
