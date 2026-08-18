// Backfill the marketplace ProductOffer rows from the legacy single-seller data.
//
// For every product it creates ONE offer mirroring the old model:
//   resellerId    = product.resellerId (null = first-party / house offer)
//   eppPrice      = active EPP ProductPrice.sellingPrice
//   smartEppPrice = active SMART_EPP ProductPrice.sellingPrice (if any)
//   mop           = active EPP ProductPrice.mop
//   quantity      = inventory.quantity
//   freeGiftId    = product.freeGiftId
//   status/active = product.status
// and sets Product.mrp = active EPP ProductPrice.mrp.
//
// Idempotent: re-running updates the same (productId, resellerId) offer in place.
// Run: npx ts-node prisma/backfill-offers.ts

import { PrismaClient, PriceType, ProductStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    include: {
      prices: { where: { isActive: true } },
      inventory: true,
    },
  });

  let created = 0;
  let updated = 0;

  for (const p of products) {
    const epp = p.prices.find((pr) => pr.priceType === PriceType.EPP) ?? p.prices[0];
    const smart = p.prices.find((pr) => pr.priceType === PriceType.SMART_EPP);
    if (!epp) {
      console.warn(`! product ${p.sku} (${p.id}) has no active price — skipping offer`);
      continue;
    }

    // Product-level MRP comes from the EPP row.
    if (p.mrp == null) {
      await prisma.product.update({ where: { id: p.id }, data: { mrp: epp.mrp } });
    }

    const active = p.status === ProductStatus.ACTIVE;
    const data = {
      eppPrice: epp.sellingPrice,
      smartEppPrice: smart?.sellingPrice ?? null,
      mop: epp.mop ?? null,
      quantity: p.inventory?.quantity ?? 0,
      freeGiftId: p.freeGiftId ?? null,
      status: p.status,
      isActive: active,
    };

    // The compound unique [productId, resellerId] can't be used in a Prisma
    // upsert when resellerId is null, so find-then-write manually.
    const existing = await prisma.productOffer.findFirst({
      where: { productId: p.id, resellerId: p.resellerId ?? null },
      select: { id: true },
    });

    if (existing) {
      await prisma.productOffer.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.productOffer.create({
        data: { productId: p.id, resellerId: p.resellerId ?? null, ...data },
      });
      created += 1;
    }
  }

  console.log(`Backfill complete: ${created} offers created, ${updated} updated, ${products.length} products scanned.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
