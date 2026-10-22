import { z } from 'zod';
import { Prisma, Role, UserStatus, OrderStatus } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { pageAll, keyset } from '../chunk';
import { defineReport, joinCell } from '../types';

/**
 * User report — one row per employee.
 *
 * Several columns are lists flattened into a single cell (wishlist, past
 * purchases, most-visited), so each is capped: a report cell is a summary, and
 * Excel refuses anything past ~32k characters anyway.
 */

const WISHLIST_CAP = 20;
const BOUGHT_CAP = 20;
const VISITED_CAP = 5;

const REALISED: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.DISPATCHED,
  OrderStatus.DELIVERED,
];

const filterSchema = z.object({
  status: z.union([z.nativeEnum(UserStatus), z.literal('all')]).default('all'),
  companyId: z.string().default('all'),
});
type Filters = z.infer<typeof filterSchema>;

interface Row {
  id: string;
  company: string;
  employeeName: string;
  gstin: string;
  status: string;
  email: string;
  phone: string;
  wishlistNames: string;
  wishlistSkus: string;
  mostVisited: string;
  bought: string;
  hrName: string;
}

const where = (f: Filters): Prisma.EmployeeWhereInput => ({
  deletedAt: null,
  ...(f.companyId === 'all' ? {} : { companyId: f.companyId }),
  ...(f.status === 'all' ? {} : { user: { status: f.status } }),
});

/**
 * HR name per company.
 *
 * The schema has two candidates and no `Company.hrUserId`: the company's single
 * admin user, and any number of employees carrying the COMPANY_HR role. We
 * prefer the admin (guaranteed at most one) and fall back to the first HR
 * employee, resolved in ONE query up front rather than per row.
 */
async function hrFallbackByCompany(): Promise<Map<string, string>> {
  const hrs = await prisma.employee.findMany({
    where: { deletedAt: null, user: { role: Role.COMPANY_HR } },
    select: { companyId: true, user: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const map = new Map<string, string>();
  for (const h of hrs) if (!map.has(h.companyId)) map.set(h.companyId, h.user.fullName);
  return map;
}

export const usersReport = defineReport<Filters, Row>({
  id: 'USERS',
  title: 'Users',
  description: 'Employees with wishlist, browsing and purchase history.',
  fileStem: 'users',
  filterSchema,
  filterFields: async () => {
    const companies = await prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return [
      {
        kind: 'select',
        key: 'companyId',
        label: 'Company',
        allLabel: 'All companies',
        options: companies.map((c) => ({ value: c.id, label: c.name })),
      },
      {
        kind: 'select',
        key: 'status',
        label: 'User status',
        allLabel: 'All statuses',
        options: Object.values(UserStatus).map((v) => ({ value: v, label: v })),
      },
    ];
  },
  columns: [
    { key: 'company', header: 'Company Name', accessor: (r) => r.company, width: 26 },
    { key: 'employeeName', header: 'Employee Name', accessor: (r) => r.employeeName, width: 24 },
    { key: 'gstin', header: 'GSTN of Company', accessor: (r) => r.gstin, width: 20 },
    { key: 'status', header: 'User Status', accessor: (r) => r.status, width: 12 },
    { key: 'email', header: 'User Email', accessor: (r) => r.email, width: 30 },
    { key: 'phone', header: 'User contact number', accessor: (r) => r.phone, width: 16 },
    { key: 'wishlistNames', header: 'User Wishlist item name', accessor: (r) => r.wishlistNames, width: 44 },
    { key: 'wishlistSkus', header: 'User Wishlist Item SKU', accessor: (r) => r.wishlistSkus, width: 30 },
    { key: 'mostVisited', header: 'Most interacted products', accessor: (r) => r.mostVisited, width: 44 },
    { key: 'bought', header: 'Product Bought / Ordered', accessor: (r) => r.bought, width: 44 },
    { key: 'hrName', header: 'HR Name', accessor: (r) => r.hrName, width: 22 },
  ],

  count: (f) => prisma.employee.count({ where: where(f) }),

  async *fetch(f) {
    const hrFallback = await hrFallbackByCompany();

    for await (const page of pageAll((cursor) =>
      prisma.employee.findMany({
        where: where(f),
        select: {
          id: true,
          company: {
            select: { id: true, name: true, gstin: true, adminUser: { select: { fullName: true } } },
          },
          user: { select: { fullName: true, email: true, phone: true, status: true } },
          addresses: {
            where: { isDefault: true },
            select: { contactPhone: true },
            take: 1,
          },
          wishlistItems: {
            select: { product: { select: { name: true, sku: true } } },
            take: WISHLIST_CAP,
            orderBy: { createdAt: 'desc' },
          },
          productViews: {
            select: { viewCount: true, product: { select: { name: true } } },
            orderBy: { viewCount: 'desc' },
            take: VISITED_CAP,
          },
          orders: {
            where: { status: { in: REALISED } },
            select: { items: { select: { product: { select: { name: true } } } } },
            take: BOUGHT_CAP,
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...keyset(cursor),
      }),
    )) {
      yield page.map((e) => ({
        id: e.id,
        company: e.company?.name ?? '',
        employeeName: e.user.fullName,
        gstin: e.company?.gstin ?? '',
        status: e.user.status,
        email: e.user.email,
        // User.phone is nullable and often unset; the default delivery address
        // carries a non-null phone, so it is the better fallback.
        phone: e.user.phone ?? e.addresses[0]?.contactPhone ?? '',
        wishlistNames: joinCell(e.wishlistItems.map((w) => w.product.name)),
        wishlistSkus: joinCell(e.wishlistItems.map((w) => w.product.sku)),
        mostVisited: joinCell(e.productViews.map((v) => `${v.product.name} (${v.viewCount})`)),
        bought: joinCell(
          Array.from(new Set(e.orders.flatMap((o) => o.items.map((i) => i.product?.name ?? '')))),
        ),
        hrName: e.company?.adminUser?.fullName ?? (e.company ? (hrFallback.get(e.company.id) ?? '') : ''),
      }));
    }
  },
});
