import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronDown, Eye, FileSpreadsheet, FileText, Search, ShoppingBag } from 'lucide-react';
import {
  Button,
  DataTable,
  Drawer,
  EmptyState,
  Input,
  ProductThumb,
  Row,
  Select,
  Skeleton,
  Spinner,
  StatusPill,
  useToast,
} from '@/components';
import { CourierAutomation, EpodCell, EpodControl, InvoiceNumberControl, TransitControl } from './OrderFulfilment';
import {
  downloadReport,
  getPartnerOrders,
  orderStatusTone,
  updateOrderTransit,
  type PartnerOrderRow,
  type ReportFormat,
} from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { fmtDate } from '@/data/map';
import { MODE_LABEL } from '@/lib/courier';
import { PERIODS } from './reports/ReportFilters';
import s from './screen.module.css';
import styles from './Partners.module.css';

const PAGE_SIZE = 25;
// Fixed floors per column (the table scrolls sideways below them rather than
// squeezing cells into each other). Update has to fit 'Out for delivery' + chevron.
// The order date sits under the order number to keep ten columns inside a laptop width.
const COLS =
  'minmax(124px,1.1fr) minmax(112px,1fr) 88px minmax(110px,1.3fr) 104px minmax(84px,0.8fr) 140px 46px 84px 66px';

// The exact order status — not the display label, which folds Placed and
// Confirmed together. Same values the Orders report's Status filter takes, so
// the Download holds exactly what the table lists.
const STATUSES: { value: string; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'PLACED', label: 'Placed' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'RETURNED', label: 'Returned' },
];
// The report's own period list, "All time" first: this tab has always opened on every order.
const TAB_PERIODS = [...PERIODS.filter((p) => p.value === 'ALL'), ...PERIODS.filter((p) => p.value !== 'ALL')];

const fileStemFor = (name?: string) =>
  `${(name ?? 'partner').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'partner'}-orders`;

// The shipment statuses staff can set. Same list as the manual transit form.
const TRANSIT_STATUSES = [
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  // The courier matcher's "Issue" column (attempted, held, refused, lost…).
  // The order stays Dispatched; the next scan moves the shipment on again.
  { value: 'FAILED', label: 'Delivery issue' },
  { value: 'RETURNED', label: 'Returned' },
];

/**
 * Partner detail → Orders tab.
 *
 * Owns its own fetch (like the Catalogue tab) because it filters, searches and
 * pages server-side. Fulfilment is updated from the row itself: the Update
 * dropdown saves on change, the ePOD cell uploads in one click, and the chevron
 * expands the full form for courier / AWB / note / courier automation.
 */
export function PartnerOrders({ partnerId, partnerName }: { partnerId: string; partnerName?: string }) {
  const { flash } = useToast();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatusFilter] = useState('all');
  const [period, setPeriod] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PartnerOrderRow[]>([]);
  const [open, setOpen] = useState<string | null>(null); // expanded row id
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // Debounce the search; any filter change resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);
  // The one filter set both the table and the Download send. Dates only count
  // for a custom range, as on the Reports screen.
  const custom = period === 'CUSTOM';
  const filters = {
    q: q || undefined,
    status,
    period,
    from: custom && from ? from : undefined,
    to: custom && to ? to : undefined,
  };
  const filterKey = JSON.stringify(filters);
  useEffect(() => setPage(1), [filterKey]);

  const { data, state, error, reload } = useAsync(
    () => getPartnerOrders(partnerId, { ...filters, page, pageSize: PAGE_SIZE }),
    [partnerId, filterKey, page],
    (d) => d.items.length === 0,
  );
  useEffect(() => {
    if (data) setRows(data.items);
  }, [data]);

  const meta = data?.meta;
  const pageCount = meta?.pageCount ?? 1;
  const filtered = Boolean(q) || status !== 'all' || period !== 'ALL';

  // The file is the admin Orders report scoped to this partner — every column it
  // has, one row per line item — so it reconciles with Reports → Orders.
  const download = async (format: ReportFormat) => {
    setBusy(format);
    try {
      await downloadReport('ORDERS_ADMIN', format, { ...filters, partnerId }, fileStemFor(partnerName));
      flash(`${format === 'CSV' ? 'CSV' : 'Excel'} downloaded`);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  };
  const drawerRow = rows.find((r) => r.id === drawerId) ?? null;

  // Inline status change: optimistic, then reconciled by the reload. A bare
  // status is safe — applyTransit only writes the AWB and courier when they are
  // passed, so it can't blank what the courier form set.
  const setStatus = async (row: PartnerOrderRow, status: string) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, shipmentStatus: status } : r)));
    try {
      await updateOrderTransit(row.id, { status });
      flash(`${row.orderNo} → ${TRANSIT_STATUSES.find((o) => o.value === status)?.label ?? status}`);
      reload();
    } catch (e) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, shipmentStatus: row.shipmentStatus } : r)));
      flash(e instanceof ApiError ? e.message : 'Could not update the status');
    }
  };

  return (
    <div className={styles.catWrap}>
      <div className={s.toolbar}>
        <div className={s.search}>
          <Input
            icon={<Search size={16} />}
            placeholder="Search order no, partner ref, product or SKU"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <Select aria-label="Status" value={status} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUSES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Order date" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {TAB_PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
        {custom && (
          <>
            <Input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <div className={s.spacer} />
        <Button
          variant="secondary"
          icon={busy === 'CSV' ? <Spinner size={14} /> : <FileText size={15} />}
          disabled={!!busy || !meta?.total}
          onClick={() => download('CSV')}
        >
          {busy === 'CSV' ? 'Preparing…' : 'Download CSV'}
        </Button>
        <Button
          icon={busy === 'XLSX' ? <Spinner size={14} /> : <FileSpreadsheet size={15} />}
          disabled={!!busy || !meta?.total}
          onClick={() => download('XLSX')}
        >
          {busy === 'XLSX' ? 'Preparing…' : 'Download Excel'}
        </Button>
      </div>

      <div className={styles.cardTitle}>
        Orders received{meta?.total ? ` · ${meta.total}` : ''}
      </div>
      <p className={styles.cardHint}>
        Set the shipment status or attach a proof of delivery here — both push straight to the partner.
        Downloads hold every column of the Orders report, one row per item, for the filters above.
      </p>

      {state === 'loading' && <Skeleton h={200} />}
      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={22} />}
          title="Couldn't load orders"
          body={error ?? ''}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}
      {state !== 'loading' && state !== 'error' && rows.length === 0 && (
        <EmptyState
          icon={<ShoppingBag size={22} />}
          title={filtered ? 'No matching orders' : 'No orders received yet'}
          body={
            filtered
              ? 'No order matches this search or filter.'
              : 'Orders this partner posts through the API will appear here.'
          }
        />
      )}

      {rows.length > 0 && (
        <>
          <div className={styles.ordScroll}>
          <DataTable
            cols={COLS}
            headers={['Order', 'Buyer', 'Dealer', 'Product', 'Status', 'Invoice', 'Update', 'ePOD', 'Total', '']}
          >
            {rows.map((o) => {
              const cancelled = o.status === 'Cancelled';
              const expanded = open === o.id;
              return (
                <div key={o.id}>
                  <Row cols={COLS} className={styles.ordRow}>
                    <div className={styles.ordId}>
                      <span>{o.orderNo}</span>
                      {o.externalRef && <span className={s.mono} title={o.externalRef}>{o.externalRef}</span>}
                      <span className={s.muted}>{fmtDate(o.createdAt)}</span>
                    </div>
                    <div className={styles.ordId}>
                      <span title={o.buyer.name ?? undefined}>{o.buyer.name ?? '—'}</span>
                      {o.buyer.phone && <span className={s.muted}>{o.buyer.phone}</span>}
                    </div>
                    <div className={styles.ordCell} title={o.dealer.name ?? undefined}>
                      {o.dealer.code ?? <span className={s.muted}>—</span>}
                    </div>
                    <div className={styles.ordProduct}>
                      {o.items[0]?.name ?? '—'}
                      {o.itemCount > 1 && <span className={s.muted}> +{o.itemCount - 1} more</span>}
                    </div>
                    <div className={styles.ordStatus}>
                      <StatusPill label={o.status} tone={orderStatusTone[o.status]} />
                      {o.deliveredAt && <span className={s.muted}>{fmtDate(o.deliveredAt)}</span>}
                    </div>
                    <div className={styles.ordCell} title={o.invoiceNumber ?? undefined}>
                      {o.invoiceNumber ? <span className={s.mono}>{o.invoiceNumber}</span> : <span className={s.muted}>—</span>}
                    </div>
                    <div>
                      {cancelled ? (
                        <span className={s.muted} style={{ fontSize: 12.5 }}>Closed</span>
                      ) : (
                        <Select
                          selectSize="sm"
                          block
                          aria-label={`Shipment status for ${o.orderNo}`}
                          value={o.shipmentStatus ?? ''}
                          onChange={(e) => setStatus(o, e.target.value)}
                        >
                          <option value="" disabled>
                            Set status…
                          </option>
                          {TRANSIT_STATUSES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                    <div>
                      <EpodCell
                        orderId={o.id}
                        delivered={o.status === 'Delivered'}
                        epod={o.fulfilment.epod}
                        onDone={reload}
                      />
                    </div>
                    <div className={s.price}>{inr(o.total)}</div>
                    <div className={styles.ordActions}>
                      <button className={s.iconBtn} onClick={() => setDrawerId(o.id)} aria-label="View order">
                        <Eye size={15} />
                      </button>
                      <button
                        className={s.iconBtn}
                        onClick={() => setOpen(expanded ? null : o.id)}
                        aria-label={expanded ? 'Hide fulfilment' : 'Update fulfilment'}
                        aria-expanded={expanded}
                      >
                        <ChevronDown size={15} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
                      </button>
                    </div>
                  </Row>

                  {expanded && (
                    <div className={styles.ordPanel}>
                      <div className={styles.ordPanelGrid}>
                        <div>
                          <div className={styles.pdSectionTitle}>Fulfilment</div>
                          <CourierAutomation
                            orderId={o.id}
                            hasAwb={Boolean(o.awb)}
                            cancelled={cancelled}
                            info={o.fulfilment}
                            onDone={reload}
                          />
                          <TransitControl
                            orderId={o.id}
                            cancelled={cancelled}
                            defaultCourier={o.courierCode ?? undefined}
                            currentAwb={o.awb}
                            currentStatus={o.shipmentStatus}
                            onDone={reload}
                          />
                        </div>
                        <div>
                          <div className={styles.pdSectionTitle}>Proof of delivery</div>
                          <EpodControl
                            orderId={o.id}
                            delivered={o.status === 'Delivered'}
                            info={o.fulfilment}
                            onDone={reload}
                          />
                          <div className={styles.pdSectionTitle} style={{ marginTop: 18 }}>Invoice</div>
                          <InvoiceNumberControl
                            orderId={o.id}
                            cancelled={cancelled}
                            invoiceNumber={o.invoiceNumber}
                            invoiceNumberAt={o.invoiceNumberAt}
                            onDone={reload}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </DataTable>
          </div>

          <div className={styles.ordPager}>
            <span className={s.muted} style={{ fontSize: 12.5 }}>
              {meta ? `${meta.total.toLocaleString()} order${meta.total === 1 ? '' : 's'} · page ${meta.page} of ${pageCount}` : ''}
            </span>
            <div className={styles.ordPagerBtns}>
              <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                Prev
              </Button>
              <Button variant="secondary" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {drawerRow && <PartnerOrderDrawer order={drawerRow} onClose={() => setDrawerId(null)} />}
    </div>
  );
}

function OrderLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={styles.ordLine}>
      <span className={strong ? undefined : s.muted}>{label}</span>
      <span className={strong ? styles.ordLineStrong : undefined}>{value}</span>
    </div>
  );
}

// One label → value row; empty values are left out so a sparse order stays short.
function MetaRows({ rows }: { rows: [string, string | null | undefined][] }) {
  const shown = rows.filter(([, v]) => v);
  if (shown.length === 0) return <p className={styles.pdText}>—</p>;
  return (
    <dl className={styles.pdMeta}>
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Read-only detail for one row: everything the partner sent and everything we
 * have recorded since — buyer, dealer, both addresses, each line's SKU /
 * variant / HSN, invoice and fulfilment. Fulfilment is edited in the row
 * itself, not here, so the same action never exists twice on one screen.
 */
function PartnerOrderDrawer({ order, onClose }: { order: PartnerOrderRow; onClose: () => void }) {
  const navigate = useNavigate();
  const pod = order.fulfilment.epod;
  return (
    <Drawer open onClose={onClose} title={order.orderNo} width={480}>
      <div className={styles.pdWrap}>
        <div className={styles.pdHead}>
          <div className={s.muted} style={{ fontSize: 12.5 }}>
            {order.externalRef ? `Ref ${order.externalRef} · ` : ''}
            {fmtDate(order.createdAt)}
          </div>
          <StatusPill label={order.status} tone={orderStatusTone[order.status]} />
        </div>

        <div className={styles.pdSection}>
          <div className={styles.pdSectionTitle}>Buyer</div>
          <MetaRows
            rows={[
              ['Name', order.buyer.name],
              ['Contact number', order.buyer.phone],
            ]}
          />
        </div>

        <div className={styles.pdSection}>
          <div className={styles.pdSectionTitle}>Dealer</div>
          <MetaRows
            rows={[
              ['Dealer code', order.dealer.code],
              ['Dealer name', order.dealer.name],
              ['Dealer mobile', order.dealer.mobile],
            ]}
          />
        </div>

        <div className={styles.pdSection}>
          <div className={styles.pdSectionTitle}>Shipping address</div>
          <p className={styles.pdText}>{order.shippingAddress || '—'}</p>
          {order.deliveryInstructions && (
            <p className={styles.pdText}>
              <span className={s.muted}>Instructions: </span>
              {order.deliveryInstructions}
            </p>
          )}
        </div>

        <div className={styles.pdSection}>
          <div className={styles.pdSectionTitle}>Billing address</div>
          <p className={styles.pdText}>
            {order.billingAddress ?? <span className={s.muted}>Same as shipping</span>}
          </p>
        </div>

        <div className={styles.pdSection}>
          <div className={styles.pdSectionTitle}>Items</div>
          <ul className={styles.ordItems}>
            {order.items.map((it, i) => (
              <li key={i} className={styles.ordItem}>
                <ProductThumb g1={it.image ?? '#dfe3ea'} g2="#b3b9c4" w={34} h={42} />
                <div className={styles.ordItemName}>
                  <span>{it.name}</span>
                  <span className={s.mono}>{it.sku}</span>
                  {(it.variant || it.hsnCode) && (
                    <span className={s.muted} style={{ fontSize: 12 }}>
                      {[it.variant, it.hsnCode && `HSN ${it.hsnCode}`].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
                <div className={styles.ordItemQty}>
                  {it.qty} × {inr(it.unitPrice)}
                </div>
                <div className={styles.ordItemTotal}>{inr(it.lineTotal)}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.pdSection}>
          <div className={styles.pdSectionTitle}>Invoice</div>
          <MetaRows
            rows={[
              ['Our invoice number', order.invoiceNumber ?? 'Not entered yet'],
              ['Entered', order.invoiceNumberAt ? fmtDate(order.invoiceNumberAt) : null],
            ]}
          />
        </div>

        <div className={styles.pdSection}>
          <div className={styles.pdSectionTitle}>Fulfilment</div>
          <MetaRows
            rows={[
              ['Reseller', order.reseller],
              ['Courier', order.courier],
              ['Delivery mode', order.deliveryMode ? (MODE_LABEL[order.deliveryMode] ?? order.deliveryMode) : null],
              ['AWB', order.awb],
              ['Dispatched', order.dispatchedAt ? fmtDate(order.dispatchedAt) : null],
              ['Delivered', order.deliveredAt ? fmtDate(order.deliveredAt) : null],
              ['Proof of delivery', pod ? 'Uploaded' : order.status === 'Delivered' ? 'Not uploaded' : null],
            ]}
          />
        </div>

        <div className={styles.pdSection}>
          <div className={styles.pdSectionTitle}>Total</div>
          <OrderLine label="Subtotal" value={inr(order.subtotal)} />
          <OrderLine label="Amount payable" value={inr(order.total)} strong />
        </div>

        <div className={styles.pdSection}>
          <button className={styles.linkBtn} onClick={() => navigate(`/super-admin/orderDetail/${order.id}`)}>
            Open full order ↗
          </button>
        </div>
      </div>
    </Drawer>
  );
}
