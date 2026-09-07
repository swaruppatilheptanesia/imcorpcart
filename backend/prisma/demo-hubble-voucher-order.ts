/**
 * Demo data: a few storefront orders for Hubble gift-card vouchers, in each
 * fulfilment state, so "Hubble (gift-card vouchers)" appears in the admin Orders
 * vendor filter and the voucher order-detail UI (buyer reveal + admin
 * status/Retry/Resend) can be seen without a live purchase.
 *
 * Safety: the codes here are DUMMY (not real Hubble vouchers). Only DELIVERED /
 * FAILED (terminal) and one PROCESSING row are created — never PENDING — and the
 * PROCESSING row carries a FAKE hubbleOrderRef, so the fulfilment engine never
 * places a real Hubble order / debits the wallet for this demo data. (On a future
 * backend restart the resume job will poll that fake ref, 404, and after the 15-min
 * cutoff flip it to FAILED — harmless, read-only.)
 *
 * Idempotent — safe to re-run (keyed on fixed orderNos).
 *
 * Run:  npx ts-node prisma/demo-hubble-voucher-order.ts
 */
import { PrismaClient, OrderType, OrderSource, OrderStatus, AddressType, VoucherFulfilmentStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1) A handful of live Hubble voucher products.
  const products = await prisma.product.findMany({
    where: { source: { slug: 'hubble' }, deletedAt: null },
    select: { id: true, name: true, brand: true, specs: true },
    orderBy: { name: 'asc' },
    take: 4,
  });
  if (products.length < 4) {
    console.error('Need at least 4 Hubble products — run the Hubble vendor sync first.');
    return;
  }

  // 2) A demo employee + company (falls back to any employee).
  const employee =
    (await prisma.employee.findFirst({
      where: { user: { email: 'rohan.m@acme.com' } },
      select: { id: true, companyId: true },
    })) ?? (await prisma.employee.findFirst({ select: { id: true, companyId: true } }));
  if (!employee) {
    console.error('No employee found to attach the demo orders to.');
    return;
  }

  // 3) Ensure a shipping address (orders require one, even for digital vouchers).
  let address = await prisma.address.findFirst({ where: { employeeId: employee.id } });
  if (!address) {
    address = await prisma.address.create({
      data: {
        type: AddressType.HOME,
        label: 'Demo address',
        employeeId: employee.id,
        contactName: 'Rohan Mehta',
        contactPhone: '9800000000',
        line1: '1 Demo Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
      },
    });
  }

  // 4) One order per fulfilment state (refresh-on-rerun: drop any existing demo
  //    voucher orders first, so re-running always yields a clean set).
  const stale = await prisma.order.findMany({
    where: { orderNo: { startsWith: 'DEMO-VCHR-' } },
    select: { id: true },
  });
  if (stale.length) {
    const ids = stale.map((o) => o.id);
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
    console.log(`· cleared ${ids.length} existing demo voucher order(s)`);
  }

  const now = new Date();
  const in1yr = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  const specs = [
    {
      orderNo: 'DEMO-VCHR-1',
      product: products[0],
      amount: 500,
      fulfilment: {
        status: VoucherFulfilmentStatus.DELIVERED,
        voucherCode: '9000-0012-2182-8659',
        voucherPin: '615890',
        voucherCardType: 'CARD_AND_PIN_NO_SECURED',
        voucherExpiry: in1yr,
        deliveredAt: now,
        hubbleOrderRef: 'DEMO-HUBBLE-ORDER-1',
      },
    },
    {
      orderNo: 'DEMO-VCHR-2',
      product: products[1],
      amount: 1000,
      fulfilment: {
        status: VoucherFulfilmentStatus.DELIVERED,
        voucherCode: 'GC7742199301122',
        voucherCardType: 'CARD_NUMBER_SECURED',
        voucherExpiry: in1yr,
        deliveredAt: now,
        hubbleOrderRef: 'DEMO-HUBBLE-ORDER-2',
      },
    },
    {
      orderNo: 'DEMO-VCHR-3',
      product: products[2],
      amount: 2000,
      fulfilment: {
        status: VoucherFulfilmentStatus.PROCESSING,
        hubbleOrderRef: 'DEMO-FAKE-PROCESSING-REF', // fake → never a real place/debit
      },
    },
    {
      orderNo: 'DEMO-VCHR-4',
      product: products[3],
      amount: 1500,
      fulfilment: {
        status: VoucherFulfilmentStatus.FAILED,
        fulfilmentError: 'Gift-card wallet balance is insufficient — please contact support',
      },
    },
  ];

  for (const s of specs) {
    const order = await prisma.order.create({
      data: {
        orderNo: s.orderNo,
        type: OrderType.EPP,
        source: OrderSource.INTERNAL,
        status: OrderStatus.CONFIRMED,
        employeeId: employee.id,
        companyId: employee.companyId,
        resellerId: null, // first-party — Hubble is a tag on the product
        addressId: address.id,
        subtotal: s.amount,
        total: s.amount,
        items: { create: [{ productId: s.product.id, quantity: 1, unitPrice: s.amount, lineTotal: s.amount }] },
        statusHistory: { create: [{ status: OrderStatus.PLACED, note: 'Demo voucher order' }] },
      },
      include: { items: true },
    });
    // Voucher issuance lives in its own table (1:1 with the order line).
    await prisma.voucherFulfilment.create({
      data: { orderItemId: order.items[0].id, denomination: s.amount, ...s.fulfilment },
    });
    console.log(`✓ ${s.orderNo} (${order.id}) — ${s.product.brand ?? s.product.name} · ₹${s.amount} · ${s.fulfilment.status}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
