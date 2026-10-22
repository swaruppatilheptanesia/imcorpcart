import { z } from 'zod';
import { Prisma, OrgStatus, ProductStatus } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { toNumber } from '../../../models/serializers';
import { pageAll, keyset } from '../chunk';
import { defineReport } from '../types';

/**
 * Resellers report — one row per reseller.
 *
 * "Product Details (products that are live)" is a list squeezed into one cell,
 * so it is rendered as a count plus the first few SKUs. The count is the useful
 * figure; the SKUs are there to make the row recognisable without opening the
 * portal.
 */

const SKU_SAMPLE = 5;

const filterSchema = z.object({
  status: z.union([z.nativeEnum(OrgStatus), z.literal('all')]).default('all'),
});
type Filters = z.infer<typeof filterSchema>;

interface Row {
  id: string;
  name: string;
  commissionPct: number | null;
  liveProducts: string;
  email: string;
  gstin: string | null;
  phone: string;
  status: string;
}

// Reseller has no soft-delete column; status is the only lifecycle flag.
const where = (f: Filters): Prisma.ResellerWhereInput =>
  f.status === 'all' ? {} : { status: f.status };

/**
 * "Live" is the buy-box eligibility test, not merely `status = ACTIVE`: a
 * product can be ACTIVE yet hidden, or deactivated by a vendor sync, and in
 * either case no shopper can buy it.
 */
const liveOfferWhere = {
  deletedAt: null,
  isActive: true,
  status: ProductStatus.ACTIVE,
  quantity: { gt: 0 },
  eppPrice: { gt: 0 },
  product: { deletedAt: null, status: ProductStatus.ACTIVE, hidden: false },
} satisfies Prisma.ProductOfferWhereInput;

export const resellersReport = defineReport<Filters, Row>({
  id: 'RESELLERS',
  title: 'Resellers',
  description: 'Reseller directory with commission, contact details and live listings.',
  fileStem: 'resellers',
  filterSchema,
  filterFields: [
    {
      kind: 'select',
      key: 'status',
      label: 'Status',
      allLabel: 'All statuses',
      options: Object.values(OrgStatus).map((v) => ({ value: v, label: v })),
    },
  ],
  columns: [
    { key: 'name', header: 'Reseller Name', accessor: (r) => r.name, width: 28 },
    { key: 'commission', header: 'Commission', accessor: (r) => r.commissionPct, width: 12, numFmt: '0.00' },
    { key: 'liveProducts', header: 'Product Details (live)', accessor: (r) => r.liveProducts, width: 52 },
    { key: 'email', header: 'Reseller Email Id', accessor: (r) => r.email, width: 30 },
    { key: 'gstin', header: 'GSTIN', accessor: (r) => r.gstin, width: 20 },
    { key: 'phone', header: 'Contact Number', accessor: (r) => r.phone, width: 16 },
    { key: 'status', header: 'Status', accessor: (r) => r.status, width: 12 },
  ],

  count: (f) => prisma.reseller.count({ where: where(f) }),

  async *fetch(f) {
    for await (const page of pageAll((cursor) =>
      prisma.reseller.findMany({
        where: where(f),
        select: {
          id: true,
          name: true,
          gstin: true,
          contactEmail: true,
          contactPhone: true,
          commissionPct: true,
          status: true,
          createdAt: true,
          // The org's own contact fields are both nullable; the linked operator
          // account is the only guaranteed-non-null email we have.
          user: { select: { email: true, phone: true } },
          offers: {
            where: liveOfferWhere,
            select: { product: { select: { sku: true } } },
            take: SKU_SAMPLE,
            orderBy: { createdAt: 'desc' },
          },
          _count: { select: { offers: { where: liveOfferWhere } } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...keyset(cursor),
      }),
    )) {
      yield page.map((r) => {
        const live = r._count.offers;
        const skus = r.offers.map((o) => o.product.sku);
        const more = live - skus.length;
        return {
          id: r.id,
          name: r.name,
          commissionPct: r.commissionPct == null ? null : toNumber(r.commissionPct),
          liveProducts: live === 0 ? 'None live' : `${live} live · ${skus.join(' | ')}${more > 0 ? ` (+${more})` : ''}`,
          email: r.contactEmail ?? r.user?.email ?? '',
          gstin: r.gstin,
          phone: r.contactPhone ?? r.user?.phone ?? '',
          status: r.status,
        };
      });
    }
  },
});
