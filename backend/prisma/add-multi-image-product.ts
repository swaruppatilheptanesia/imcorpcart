/**
 * Adds one ACTIVE, reseller-authored product with MULTIPLE images so the
 * storefront product-detail carousel can be demoed. Idempotent: keyed on sku
 * (deletes any prior copy, then recreates). Run:  npx ts-node prisma/add-multi-image-product.ts
 */
import { PrismaClient, Prisma, PriceType, ProductStatus } from '@prisma/client';

const prisma = new PrismaClient();
const D = (n: number) => new Prisma.Decimal(n);

const SKU = 'TR-DEMO-CAROUSEL';

// Distinct, always-available placeholder photos (labelled per angle) so each
// carousel slide is visibly different.
const IMAGES = [
  'https://dummyimage.com/900x900/4a7fc0/ffffff&text=Aurora+X+Pro+%C2%B7+Front',
  'https://dummyimage.com/900x900/123a72/ffffff&text=Aurora+X+Pro+%C2%B7+Back',
  'https://dummyimage.com/900x900/2b2f36/ffffff&text=Aurora+X+Pro+%C2%B7+Side',
  'https://dummyimage.com/900x900/1f6f52/ffffff&text=In+the+box',
];

const shades = [
  { name: 'Aurora Blue', g1: '#4a7fc0', g2: '#123a72', stock: 22 },
  { name: 'Midnight', g1: '#2b2f36', g2: '#0b0d10', stock: 18 },
];

const rows = [
  { k: 'Display', v: '6.7-inch LTPO OLED · 120Hz' },
  { k: 'Chip', v: 'Aurora A2 Pro' },
  { k: 'RAM', v: '12GB' },
  { k: 'Storage', v: '256GB' },
  { k: 'Rear camera', v: '50MP main · 3× telephoto' },
  { k: 'Battery', v: '5000mAh · 80W fast charge' },
];

async function main() {
  const reseller = await prisma.reseller.findFirst({ where: { name: 'TechnoReseller' }, select: { id: true } });
  const category = await prisma.category.findFirst({ where: { slug: 'phones' }, select: { id: true } });
  if (!reseller || !category) throw new Error('Seed data missing (reseller/category). Run prisma/test-data.ts first.');

  // Idempotent: remove any previous copy (images/prices/inventory cascade).
  await prisma.product.deleteMany({ where: { sku: SKU } });

  const product = await prisma.product.create({
    data: {
      sku: SKU,
      name: 'Aurora X Pro · 256GB',
      brand: 'Aurora',
      description:
        'A flagship built for corporate carry — titanium-grade frame, a brilliant 120Hz OLED display, ' +
        'pro-grade cameras, and all-day battery with 80W fast charging.',
      categoryId: category.id,
      subCategory: 'flagship',
      status: ProductStatus.ACTIVE,
      resellerId: reseller.id,
      rating: 4.6,
      reviewCount: 512,
      freebieText: 'Free case + tempered glass',
      colorOptions: shades.map((s) => s.name).join(', '),
      variantOptions: '256GB storage and 12GB RAM, 512GB storage and 12GB RAM',
      specs: { g1: shades[0].g1, g2: shades[0].g2, newness: 999, shades, rows },
      inventory: { create: { quantity: 40 } },
      prices: {
        create: [
          { priceType: PriceType.EPP, mrp: D(82999), sellingPrice: D(74999) },
          { priceType: PriceType.SMART_EPP, mrp: D(82999), sellingPrice: D(77249) },
        ],
      },
      images: { create: IMAGES.map((url, i) => ({ url, position: i })) },
    },
    select: { id: true, sku: true, name: true },
  });

  console.log('Created product:', product.name, `(sku ${product.sku})`, 'with', IMAGES.length, 'images.');
  console.log('Open the storefront → Phones → "Aurora X Pro" to see the carousel.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
