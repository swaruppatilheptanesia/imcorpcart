import { z } from 'zod';
import { OrderStatus } from '@prisma/client';
import { REPORT_PERIODS } from '../../../utils/date-range';
import { defineReport, fmtDate, yesNo } from '../types';
import { countOrderLines, fetchOrderLines, type OrderLineRow } from './orders-common';

/** Orders report (Super Admin) — one row per order line. */

const filterSchema = z.object({
  period: z.enum(REPORT_PERIODS).default('MONTH'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.union([z.nativeEnum(OrderStatus), z.literal('all')]).default('all'),
});
type Filters = z.infer<typeof filterSchema>;

export const ordersAdminReport = defineReport<Filters, OrderLineRow>({
  id: 'ORDERS_ADMIN',
  title: 'Orders',
  description: 'All orders, one row per line item, with dispatch and delivery proof.',
  fileStem: 'orders',
  filterSchema,
  filterFields: [
    { kind: 'period', key: 'period', label: 'Order date', defaultValue: 'MONTH' },
    {
      kind: 'select',
      key: 'status',
      label: 'Status',
      allLabel: 'All statuses',
      options: Object.values(OrderStatus).map((v) => ({ value: v, label: v })),
    },
  ],
  columns: [
    { key: 'orderNo', header: 'Order ID', accessor: (r) => r.orderNo, width: 18 },
    { key: 'orderDate', header: 'Order Date', accessor: (r) => fmtDate(r.createdAt), width: 13 },
    { key: 'product', header: 'Product', accessor: (r) => r.product, width: 44 },
    { key: 'vendor', header: 'Vendor', accessor: (r) => r.vendor, width: 24 },
    { key: 'company', header: 'Company', accessor: (r) => r.company, width: 24 },
    { key: 'status', header: 'Status', accessor: (r) => r.status, width: 13 },
    { key: 'dispatchDate', header: 'Dispatch Date', accessor: (r) => fmtDate(r.dispatchedAt), width: 13 },
    { key: 'courier', header: 'Dispatch Partner', accessor: (r) => r.courier, width: 18 },
    { key: 'deliveryMode', header: 'Delivery Mode', accessor: (r) => r.deliveryMode, width: 14 },
    { key: 'address', header: 'Address of Delivery', accessor: (r) => r.address, width: 46 },
    { key: 'pincode', header: 'Pincode of Delivery', accessor: (r) => r.pincode, width: 13 },
    { key: 'awb', header: 'AWB', accessor: (r) => r.awb, width: 20 },
    { key: 'pod', header: 'POD', accessor: (r) => yesNo(r.hasPod), width: 8 },
    { key: 'podNote', header: 'POD note', accessor: (r) => r.podNote, width: 36 },
    {
      // Specified by the client, but there is no WhatsApp integration and no
      // acknowledgement record anywhere in the system — so the header ships and
      // the value is always blank, by agreement, rather than being faked.
      key: 'whatsappConfirmed',
      header: 'Received Confirmation',
      accessor: () => '',
      width: 20,
    },
  ],
  count: (f) => countOrderLines(f),
  fetch: (f) => fetchOrderLines(f),
});
