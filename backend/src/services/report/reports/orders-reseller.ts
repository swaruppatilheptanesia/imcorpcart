import { z } from 'zod';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { REPORT_PERIODS } from '../../../utils/date-range';
import { defineReport, fmtDate, type FilterFieldDef } from '../types';
import { countOrderLines, fetchOrderLines, type OrderLineRow } from './orders-common';

/**
 * Orders report (Reseller view) — admin-only, scoped by a vendor dropdown.
 *
 * Carries buyer name, phone and company, so it deliberately lives on the
 * SUPER_ADMIN surface rather than in the reseller portal: the reseller can
 * already see those details one order at a time, but bulk export of buyer
 * contact data stays in-house.
 */

const filterSchema = z.object({
  period: z.enum(REPORT_PERIODS).default('MONTH'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.union([z.nativeEnum(OrderStatus), z.literal('all')]).default('all'),
  resellerId: z.string().default('all'),
});
type Filters = z.infer<typeof filterSchema>;

/** Resolved at catalogue time so the screen needs no notion of "reseller". */
async function filterFields(): Promise<FilterFieldDef[]> {
  const resellers = await prisma.reseller.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return [
    { kind: 'period', key: 'period', label: 'Order date', defaultValue: 'MONTH' },
    {
      kind: 'select',
      key: 'resellerId',
      label: 'Vendor',
      allLabel: 'All vendors',
      options: resellers.map((r) => ({ value: r.id, label: r.name })),
    },
    {
      kind: 'select',
      key: 'status',
      label: 'Status',
      allLabel: 'All statuses',
      options: Object.values(OrderStatus).map((v) => ({ value: v, label: v })),
    },
  ];
}

export const ordersResellerReport = defineReport<Filters, OrderLineRow>({
  id: 'ORDERS_RESELLER',
  title: 'Orders by vendor',
  description: 'Vendor-facing order view with buyer contact details.',
  fileStem: 'orders-by-vendor',
  filterSchema,
  filterFields,
  columns: [
    { key: 'orderNo', header: 'Order ID', accessor: (r) => r.orderNo, width: 18 },
    { key: 'orderDate', header: 'Order Date', accessor: (r) => fmtDate(r.createdAt), width: 13 },
    { key: 'product', header: 'Product', accessor: (r) => r.product, width: 44 },
    { key: 'buyerName', header: 'Buyer Name', accessor: (r) => r.buyerName, width: 24 },
    { key: 'buyerPhone', header: 'Contact Number of Buyer', accessor: (r) => r.buyerPhone, width: 18 },
    { key: 'company', header: 'Company Name of Buyer', accessor: (r) => r.company, width: 26 },
    { key: 'status', header: 'Status', accessor: (r) => r.status, width: 13 },
    { key: 'deliveredAt', header: 'Delivery Date', accessor: (r) => fmtDate(r.deliveredAt), width: 13 },
    { key: 'courier', header: 'Dispatch Partner', accessor: (r) => r.courier, width: 18 },
    { key: 'pincode', header: 'Pincode of Delivery', accessor: (r) => r.pincode, width: 13 },
    { key: 'address', header: 'Address of Delivery', accessor: (r) => r.address, width: 46 },
    { key: 'awb', header: 'AWB', accessor: (r) => r.awb, width: 20 },
  ],
  count: (f) => countOrderLines(f),
  fetch: (f) => fetchOrderLines(f),
});
