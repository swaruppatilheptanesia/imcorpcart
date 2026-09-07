/**
 * Demo data: a couple of admin orders that contain an imported vendor's product
 * (e.g. MobileAccessories), so the inbound vendor tag is visible on the admin
 * Orders list + detail. Idempotent — safe to re-run (keyed on a fixed orderNo).
 *
 * Run:  npx ts-node prisma/demo-vendor-order.ts
 */
import { PrismaClient, OrderType, OrderSource, OrderStatus, AddressType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1) Two live, imported (first-party) vendor products.
  const offers = await prisma.productOffer.findMany({
    where: { resellerId: null, isActive: true, eppPrice: { gt: 0 }, product: { sourceId: { not: null } } },
    select: { eppPrice: true, product: { select: { id: true, name: true, source: { select: { name: true } } } } },
    orderBy: { product: { name: 'asc' } },
    take: 2,
  });
  if (offers.length === 0) {
    console.error('No imported vendor products found — run a Vendor Sources sync first.');
    return;
  }

  // 2) A demo employee + company (falls back to any employee).
  const employee =
    (await prisma.employee.findFirst({
      where: { user: { email: 'rohan.m@acme.com' } },
      select: { id: true, companyId: true },
    })) ?? (await prisma.employee.findFirst({ select: { id: true, companyId: true } }));
  if (!employee) {
    console.error('No employee found to attach the demo order to.');
    return;
  }

  // 3) Ensure a shipping address for that employee.
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

  // 4) Upsert one order per product (fixed orderNo → idempotent).
  for (let i = 0; i < offers.length; i++) {
    const o = offers[i];
    const orderNo = `DEMO-MA-${i + 1}`;
    const qty = 1;
    const unit = o.eppPrice; // Decimal
    const amount = Number(o.eppPrice) * qty;

    const existing = await prisma.order.findUnique({ where: { orderNo }, select: { id: true } });
    if (existing) {
      console.log(`· ${orderNo} already exists — skipping (${o.product.source?.name} · ${o.product.name.slice(0, 40)})`);
      continue;
    }

    const order = await prisma.order.create({
      data: {
        orderNo,
        type: OrderType.EPP,
        source: OrderSource.INTERNAL,
        status: OrderStatus.CONFIRMED,
        employeeId: employee.id,
        companyId: employee.companyId,
        resellerId: null, // first-party — the vendor is only a tag on the product
        addressId: address.id,
        subtotal: amount,
        total: amount,
        items: { create: [{ productId: o.product.id, quantity: qty, unitPrice: unit, lineTotal: amount }] },
        statusHistory: { create: [{ status: OrderStatus.PLACED, note: 'Demo order (vendor product)' }] },
      },
    });
    console.log(`✓ ${orderNo} (${order.id}) — ${o.product.source?.name} · ${o.product.name.slice(0, 50)} · ₹${amount}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
