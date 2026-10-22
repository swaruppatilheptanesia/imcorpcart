import { z } from 'zod';
import { Prisma, ProductStatus, OrderStatus } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { notDeleted } from '../../../models/selectors';
import { toNumber } from '../../../models/serializers';
import { shopProductInclude, pickBuyBox, pickDisplayOffer } from '../../shop.service';
import { REPORT_PERIODS, resolvePeriod, dateWhere, type ReportPeriod } from '../../../utils/date-range';
import { pageAll, keyset } from '../chunk';
import { defineReport, fmtDate, joinCell, yesNo } from '../types';

/**
 * Products report — the catalogue master, one row per SKU.
 *
 * Prices and stock come from the SAME buy-box rule the storefront quotes
 * (`pickDisplayOffer` / `pickBuyBox`), not a second rule invented here: a
 * product's price lives on its per-seller offers, and an admin comparing this
 * sheet against a product page must see the same number.
 */

const filterSchema = z.object({
  period: z.enum(REPORT_PERIODS).default('ALL'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.union([z.nativeEnum(ProductStatus), z.literal('all')]).default('all'),
});
type Filters = z.infer<typeof filterSchema>;

const productInclude = {
  ...shopProductInclude,
  freeGift: { select: { title: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/** The row the accessors read: already flattened, no Prisma shapes. */
interface Row {
  id: string;
  sku: string;
  name: string;
  createdAt: Date;
  category: string;
  brand: string | null;
  subCategory: string | null;
  colorOptions: string | null;
  variantOptions: string | null;
  familyKey: string | null;
  optionColor: string | null;
  optionVariant: string | null;
  specification: string;
  description: string | null;
  freebies: string;
  stock: number;
  status: string;
  mrp: number;
  mop: number | null;
  eppPrice: number | null;
  smartEppPrice: number | null;
  smartEpp: boolean;
  soldUnits: number;
}

function where(f: Filters): Prisma.ProductWhereInput {
  const created = dateWhere(resolvePeriod(f.period, { from: f.from, to: f.to }));
  return {
    ...notDeleted,
    ...(f.status === 'all' ? {} : { status: f.status }),
    ...(created ? { createdAt: created } : {}),
  };
}

/** `{ rows: [{k,v}] }` → `"RAM: 8GB | Display: 6.1 in"`. */
function flattenSpecs(specs: Prisma.JsonValue | null): string {
  if (!specs || typeof specs !== 'object' || Array.isArray(specs)) return '';
  const rows = (specs as { rows?: { k?: string; v?: string }[] }).rows;
  if (!Array.isArray(rows)) return '';
  return joinCell(rows.map((r) => (r?.k && r?.v ? `${r.k}: ${r.v}` : null)));
}

/**
 * Units sold per product, in ONE aggregation for the whole run — never a query
 * per row. Uses the same realised-status set as the dashboard so the two
 * reconcile; the first question asked of a new report is why its totals differ.
 */
const REALISED: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.DISPATCHED,
  OrderStatus.DELIVERED,
];

async function soldUnitsByProduct(): Promise<Map<string, number>> {
  const rows = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: { order: { status: { in: REALISED } } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.productId, r._sum.quantity ?? 0]));
}

function toRow(p: ProductRow, sold: Map<string, number>): Row {
  const display = pickDisplayOffer(p.offers);
  const buyBox = pickBuyBox(p.offers);
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    createdAt: p.createdAt,
    category: p.category?.name ?? '',
    brand: p.brand,
    subCategory: p.subCategory,
    colorOptions: p.colorOptions,
    variantOptions: p.variantOptions,
    familyKey: p.familyKey,
    optionColor: p.optionColor,
    optionVariant: p.optionVariant,
    specification: flattenSpecs(p.specs),
    description: p.description,
    // Same precedence the storefront uses: the winning offer's gift wins, then
    // the master's gift, then the first-party freebie text.
    freebies: display?.freeGift?.title ?? p.freeGift?.title ?? p.freebieText ?? '',
    // Stock is what can actually be SOLD, so it is 0 when nothing is buyable
    // even though a price still shows (that price comes from the display offer).
    stock: buyBox?.quantity ?? 0,
    status: p.status,
    mrp: toNumber(p.mrp),
    mop: p.mop == null ? null : toNumber(p.mop),
    eppPrice: display ? toNumber(display.eppPrice) : null,
    smartEppPrice: display?.smartEppPrice == null ? null : toNumber(display.smartEppPrice),
    smartEpp: p.smartEpp,
    soldUnits: sold.get(p.id) ?? 0,
  };
}

export const productsReport = defineReport<Filters, Row>({
  id: 'PRODUCTS',
  title: 'Products',
  description: 'Catalogue master with buy-box price, stock and units sold.',
  fileStem: 'products',
  filterSchema,
  filterFields: [
    { kind: 'period', key: 'period', label: 'Added', defaultValue: 'ALL' },
    {
      kind: 'select',
      key: 'status',
      label: 'Status',
      allLabel: 'All statuses',
      options: Object.values(ProductStatus).map((v) => ({ value: v, label: v })),
    },
  ],
  columns: [
    { key: 'sku', header: 'SKU', accessor: (r) => r.sku, width: 20 },
    { key: 'name', header: 'Product Name', accessor: (r) => r.name, width: 44 },
    { key: 'addedDate', header: 'Added Date', accessor: (r) => fmtDate(r.createdAt), width: 13 },
    { key: 'category', header: 'Category', accessor: (r) => r.category, width: 18 },
    { key: 'brand', header: 'Brand', accessor: (r) => r.brand, width: 16 },
    { key: 'subCategory', header: 'sub_category', accessor: (r) => r.subCategory, width: 18 },
    { key: 'colorOptions', header: 'color_options', accessor: (r) => r.colorOptions, width: 20 },
    { key: 'variantOptions', header: 'variant_options', accessor: (r) => r.variantOptions, width: 20 },
    { key: 'familyKey', header: 'family_key', accessor: (r) => r.familyKey, width: 18 },
    { key: 'optionColor', header: 'option_color', accessor: (r) => r.optionColor, width: 14 },
    { key: 'optionVariant', header: 'option_variant', accessor: (r) => r.optionVariant, width: 14 },
    { key: 'specification', header: 'Specification', accessor: (r) => r.specification, width: 50 },
    { key: 'description', header: 'Description', accessor: (r) => r.description, width: 50 },
    { key: 'freebies', header: 'Freebies', accessor: (r) => r.freebies, width: 24 },
    { key: 'stock', header: 'Stock', accessor: (r) => r.stock, width: 9 },
    { key: 'status', header: 'Product Status', accessor: (r) => r.status, width: 14 },
    { key: 'mrp', header: 'mrp', accessor: (r) => r.mrp, width: 12, numFmt: '#,##0.00' },
    { key: 'mop', header: 'mop_price', accessor: (r) => r.mop, width: 12, numFmt: '#,##0.00' },
    { key: 'eppPrice', header: 'epp_price', accessor: (r) => r.eppPrice, width: 12, numFmt: '#,##0.00' },
    { key: 'smartEppPrice', header: 'Smart_epp_price', accessor: (r) => r.smartEppPrice, width: 14, numFmt: '#,##0.00' },
    { key: 'smartEpp', header: 'Smart Epp Status', accessor: (r) => yesNo(r.smartEpp), width: 15 },
    { key: 'soldUnits', header: 'Sold units', accessor: (r) => r.soldUnits, width: 11 },
  ],

  count: (f) => prisma.product.count({ where: where(f) }),

  async *fetch(f) {
    const sold = await soldUnitsByProduct();
    for await (const page of pageAll((cursor) =>
      prisma.product.findMany({
        where: where(f),
        include: productInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...keyset(cursor),
      }),
    )) {
      yield page.map((p) => toRow(p, sold));
    }
  },
});
