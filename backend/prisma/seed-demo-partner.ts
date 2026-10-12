/**
 * Standalone demo-partner seed — one ACTIVE integration partner with a
 * catalogue and a book of orders in every fulfilment state, so Super Admin →
 * Partners → Demo Partner → **Orders** is demoable without a live vendor
 * posting to the partner API.
 *
 * Orders are created through the real `acceptOrder` service (the same path a
 * partner's POST /partner-api/v1/orders takes) and advanced through the real
 * `applyTransit`, so what you see is what production would produce — statuses,
 * tracking events, status history and shipments all written the normal way.
 * The partner has **no webhook URL**, so none of this queues a delivery to an
 * endpoint that doesn't exist.
 *
 * Idempotent: every order carries a stable `externalRef` (DEMO-0001…), and
 * `acceptOrder` dedupes on it, so re-running tops the set up rather than
 * duplicating it.
 *
 *   npm run db:seed-demo-partner
 */
import fs from 'fs';
import path from 'path';
import {
  CourierCode,
  DocumentType,
  OrderStatus,
  OrgStatus,
  PartnerPriceBasis,
  Prisma,
  ProductStatus,
  ShipmentStatus,
} from '@prisma/client';
import { prisma } from '../src/config/prisma';
import { acceptOrder, cancelPartnerOrder } from '../src/services/partner-order.service';
import { applyTransit } from '../src/services/reseller.service';
import { attachOrderEpod } from '../src/services/order.service';
import { encryptSecret, hashToken } from '../src/utils/secretbox';
import { PRIVATE_UPLOAD_DIR } from '../src/config/document-upload';
import type { PartnerPrincipal } from '../src/types/express';

const PARTNER_ID = 'seed-partner-demo';
const SLUG = 'demo-partner';
// Fixed so a re-run doesn't invalidate the token someone pasted into Postman.
// This is demo data in a demo partner — a real partner's token is random and
// shown once.
const TOKEN = 'imcsk_demo_partner_token_do_not_use_in_production';
const WEBHOOK_SECRET = 'imcwh_demo_partner_secret_do_not_use_in_production';

const ORDER_COUNT = 32; // > one page, so the pager has something to do

// Resolved by SKU — any that aren't in this database are skipped, so the seed
// works against a trimmed catalogue too.
const WANTED_SKUS = [
  'TR-SS-5501',
  'demo-rsl-phone',
  'demo-rsl-earbuds',
  'demo-rsl-powerbank',
  'demo-rsl-charger',
  'demo-rsl-case',
  'IMC-AP-2200',
  'GP-AN-0065',
  'UC-WC-0025',
  'TR-SS-2500',
];

const SHIPPING = [
  { name: 'Ravi Menon', phone: '9820011221', line1: '14 Marine Lines', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
  { name: 'Anita Deshpande', phone: '9881122330', line1: '5 Shivaji Nagar', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
  { name: 'Karan Malhotra', phone: '9810044556', line1: '22 Connaught Place', city: 'New Delhi', state: 'Delhi', pincode: '110001' },
  { name: 'Hiral Shah', phone: '9879955440', line1: '8 Ashram Road', city: 'Ahmedabad', state: 'Gujarat', pincode: '380001' },
];

const DEALERS = [
  { code: 'DLR-MUM-01', name: 'Sunrise Mobiles, Dadar', mobile: '9820001111' },
  { code: 'DLR-PUN-04', name: 'Kothrud Electronics', mobile: '9881002222' },
  { code: 'DLR-DEL-09', name: 'CP Gadget House', mobile: '9810003333' },
  { code: 'DLR-AMD-02', name: 'Navrangpura Digital', mobile: '9879004444' },
];

// What each order ends up as. Cycled, so every bucket and every control state
// (no AWB yet · in flight · delivered without a POD · delivered with one ·
// cancelled · returned) is represented on the first page.
type Stage = 'placed' | 'confirmed' | 'dispatched' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'delivered_epod' | 'cancelled' | 'returned';
const STAGES: Stage[] = [
  'delivered_epod', 'placed', 'out_for_delivery', 'delivered', 'confirmed', 'in_transit',
  'cancelled', 'dispatched', 'delivered_epod', 'placed', 'delivered', 'returned',
];

const COURIERS: CourierCode[] = [CourierCode.BLUEDART, CourierCode.DTDC, CourierCode.DELHIVERY];
const SHIPMENT_FOR: Partial<Record<Stage, ShipmentStatus>> = {
  dispatched: ShipmentStatus.DISPATCHED,
  in_transit: ShipmentStatus.IN_TRANSIT,
  out_for_delivery: ShipmentStatus.OUT_FOR_DELIVERY,
  delivered: ShipmentStatus.DELIVERED,
  delivered_epod: ShipmentStatus.DELIVERED,
  returned: ShipmentStatus.RETURNED,
};

const DAY = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A tiny but valid PDF, so the ePOD download opens in a viewer. */
function podPdf(orderNo: string): Buffer {
  const text = `Proof of delivery - ${orderNo} (demo)`;
  const body = `BT /F1 12 Tf 60 720 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { out += `${String(o).padStart(10, '0')} 00000 n \n`; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function main() {
  // ── 1. the partner ─────────────────────────────────────────────────────────
  const partner = await prisma.partner.upsert({
    where: { id: PARTNER_ID },
    update: { status: OrgStatus.ACTIVE, active: true, deletedAt: null },
    create: {
      id: PARTNER_ID,
      name: 'Demo Partner',
      slug: SLUG,
      contactEmail: 'ops@demopartner.example',
      contactPhone: '9000000000',
      status: OrgStatus.ACTIVE,
      active: true,
      apiTokenHash: hashToken(TOKEN),
      apiTokenLast4: TOKEN.slice(-4),
      webhookSecretEnc: encryptSecret(WEBHOOK_SECRET),
      webhookSecretLast4: WEBHOOK_SECRET.slice(-4),
      ipAllowlist: [],
      // Deliberately null: demo traffic must not queue deliveries to a URL that
      // isn't listening. Set one in the UI to exercise the webhook log.
      webhookUrl: null,
      priceField: PartnerPriceBasis.MOP,
      commissionPct: new Prisma.Decimal(5),
    },
  });

  const principal: PartnerPrincipal = {
    id: partner.id,
    name: partner.name,
    slug: partner.slug,
    commissionPct: partner.commissionPct ? Number(partner.commissionPct) : null,
    webhookUrl: partner.webhookUrl,
    features: null,
  };

  // ── 2. its catalogue ───────────────────────────────────────────────────────
  const products = await prisma.product.findMany({
    where: { sku: { in: WANTED_SKUS }, status: ProductStatus.ACTIVE, deletedAt: null },
    select: { id: true, sku: true, name: true },
  });
  if (!products.length) {
    throw new Error('No demo products found — run `npx ts-node prisma/test-data.ts` first.');
  }
  for (const p of products) {
    await prisma.partnerCatalogueEntry.upsert({
      where: { partnerId_productId: { partnerId: partner.id, productId: p.id } },
      update: {},
      create: { partnerId: partner.id, productId: p.id, priceBasis: PartnerPriceBasis.MOP, commissionPct: new Prisma.Decimal(5) },
    });
  }
  console.log(`catalogue: ${products.length} products`);

  // ── 3. the order book ──────────────────────────────────────────────────────
  const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < ORDER_COUNT; i += 1) {
    const ref = `DEMO-${String(i + 1).padStart(4, '0')}`;
    const stage = STAGES[i % STAGES.length];
    const ship = SHIPPING[i % SHIPPING.length];
    const dealer = DEALERS[i % DEALERS.length];
    // Newest first in the table, so index 0 is the most recent.
    const placedAt = new Date(Date.now() - (i * 1.4 + 1) * DAY);

    const already = await prisma.order.findFirst({ where: { partnerId: partner.id, externalRef: ref }, select: { id: true } });
    if (already) { skipped += 1; continue; }

    // 1–2 lines per order, rotating through the catalogue.
    const a = products[i % products.length];
    const b = products[(i + 3) % products.length];
    const items = [{ sku: a.sku, qty: (i % 3) + 1 }];
    if (i % 4 === 0 && b.sku !== a.sku) items.push({ sku: b.sku, qty: 1 });

    const res = await acceptOrder(principal, {
      externalRef: ref,
      dealerCode: dealer.code,
      dealerName: dealer.name,
      dealerMobile: dealer.mobile,
      deliveryInstructions: i % 5 === 0 ? 'Call on arrival — reception closes at 6pm.' : undefined,
      items,
      shipping: { ...ship },
    } as Parameters<typeof acceptOrder>[1]);

    if (res.statusCode !== 201) {
      console.log(`  ${ref}: rejected — ${JSON.stringify(res.body).slice(0, 160)}`);
      continue;
    }
    created += 1;
    await sleep(3); // orderNo is minted from Date.now(); keep them distinct

    const orders = await prisma.order.findMany({
      where: { partnerId: partner.id, externalRef: ref },
      include: { shipment: true },
    });

    // Backdate the placement so the list reads like a real book.
    await prisma.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { createdAt: placedAt } });

    for (const [oi, order] of orders.entries()) {
      if (stage === 'placed') continue;

      if (stage === 'confirmed') {
        await prisma.order.update({ where: { id: order.id }, data: { status: OrderStatus.CONFIRMED } });
        await prisma.orderStatusHistory.create({ data: { orderId: order.id, status: OrderStatus.CONFIRMED, note: 'Confirmed with the dealer' } });
        continue;
      }

      if (stage === 'cancelled') {
        await cancelPartnerOrder(principal, ref, 'Customer changed their mind');
        continue;
      }

      const shipmentStatus = SHIPMENT_FOR[stage]!;
      const courier = COURIERS[i % COURIERS.length];
      await applyTransit(
        order,
        {
          status: shipmentStatus,
          // Split orders ship separately, so each gets its own waybill.
          awbNumber: `${courier.slice(0, 2)}${7400000 + i * 10 + oi}`,
          courierCode: courier,
          description: undefined,
        } as Parameters<typeof applyTransit>[1],
        null,
      );

      // applyTransit stamps "now"; move the shipment dates onto the order's own
      // timeline so dispatch never predates placement.
      const dispatchedAt = new Date(placedAt.getTime() + DAY);
      const deliveredAt = new Date(placedAt.getTime() + 3 * DAY);
      await prisma.shipment.updateMany({
        where: { orderId: order.id },
        data: {
          dispatchedAt,
          ...(shipmentStatus === ShipmentStatus.DELIVERED ? { deliveredAt } : {}),
        },
      });

      if (stage === 'delivered_epod' && admin) {
        const file = path.join(PRIVATE_UPLOAD_DIR, `demo-pod-${order.orderNo}.pdf`);
        const buf = podPdf(order.orderNo);
        fs.writeFileSync(file, buf);
        await attachOrderEpod(
          order.id,
          { path: file, originalname: `pod-${order.orderNo}.pdf`, mimetype: 'application/pdf', size: buf.length } as Express.Multer.File,
          { capturedAt: deliveredAt },
          admin.id,
        );
      }
    }
  }

  const total = await prisma.order.count({ where: { partnerId: partner.id } });
  console.log(`orders: ${created} created, ${skipped} already present — ${total} on the partner`);
  console.log(`\nDemo Partner is live at /super-admin/partnerDetail/${partner.id}`);
  console.log(`API token (demo only): ${TOKEN}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
