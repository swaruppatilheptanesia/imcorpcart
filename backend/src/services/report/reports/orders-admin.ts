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
  // Hidden filters (no filterField): used by the Partner → Orders tab's download.
  partnerId: z.string().trim().min(1).optional(),
  q: z.string().trim().optional(),
});
type Filters = z.infer<typeof filterSchema>;

export const ordersAdminReport = defineReport<Filters, OrderLineRow>({
  id: 'ORDERS_ADMIN',
  title: 'Orders',
  description: 'All orders, one row per line item, with buyer, pricing, invoice, dispatch and delivery proof.',
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
  // Buyer = the shipping contact (for a partner order, whoever the partner sent
  // in `shipping`); Billing Address = the order's billing address, else the
  // shipping address — partners send no billing, so theirs is always shipping.
  // Unit Price and Total Order amount are numbers so they sum in Excel; the
  // total is the whole order's and repeats down a multi-line order.
  columns: [
    { key: 'orderNo', header: 'Order ID', accessor: (r) => r.orderNo, width: 18 },
    { key: 'orderDate', header: 'Order Date', accessor: (r) => fmtDate(r.createdAt), width: 13 },
    { key: 'product', header: 'Product', accessor: (r) => r.product, width: 44 },
    { key: 'sku', header: 'Product SKU', accessor: (r) => r.sku, width: 22 },
    { key: 'variant', header: 'Variant/Colour', accessor: (r) => r.variant, width: 18 },
    { key: 'hsnCode', header: 'HSN Code', accessor: (r) => r.hsnCode, width: 11 },
    { key: 'quantity', header: 'Quantity Ordered', accessor: (r) => r.quantity, width: 10 },
    { key: 'unitPrice', header: 'Unit Price', accessor: (r) => r.unitPrice, width: 13, numFmt: '#,##0.00' },
    { key: 'orderTotal', header: 'Total Order amount', accessor: (r) => r.orderTotal, width: 15, numFmt: '#,##0.00' },
    { key: 'vendor', header: 'Vendor', accessor: (r) => r.vendor, width: 24 },
    { key: 'company', header: 'Company', accessor: (r) => r.company, width: 24 },
    { key: 'buyerName', header: 'Buyer Name', accessor: (r) => r.buyerName, width: 22 },
    { key: 'buyerPhone', header: 'Buyer Contact Number', accessor: (r) => r.buyerPhone, width: 16 },
    { key: 'dealerCode', header: 'Dealer Code', accessor: (r) => r.dealerCode, width: 14 },
    { key: 'status', header: 'Status', accessor: (r) => r.status, width: 13 },
    { key: 'invoiceNumber', header: 'Our Invoice Number', accessor: (r) => r.invoiceNumber, width: 18 },
    { key: 'dispatchDate', header: 'Dispatch Date', accessor: (r) => fmtDate(r.dispatchedAt), width: 13 },
    { key: 'deliveryDate', header: 'Delivery Date', accessor: (r) => fmtDate(r.deliveredAt), width: 13 },
    { key: 'courier', header: 'Dispatch Partner', accessor: (r) => r.courier, width: 18 },
    { key: 'deliveryMode', header: 'Delivery Mode', accessor: (r) => r.deliveryMode, width: 14 },
    { key: 'address', header: 'Address of Delivery', accessor: (r) => r.address, width: 46 },
    { key: 'billingAddress', header: 'Billing Address', accessor: (r) => r.billingAddress, width: 46 },
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
