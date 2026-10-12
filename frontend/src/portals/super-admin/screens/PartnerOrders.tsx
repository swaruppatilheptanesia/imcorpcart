import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronDown, Eye, Search, ShoppingBag } from 'lucide-react';
import {
  Button,
  Chip,
  DataTable,
  Drawer,
  EmptyState,
  Input,
  ProductThumb,
  Row,
  Select,
  Skeleton,
  StatusPill,
  useToast,
} from '@/components';
import { CourierAutomation, EpodCell, EpodControl, TransitControl } from './OrderFulfilment';
import {
  getPartnerOrders,
  orderStatusTone,
  updateOrderTransit,
  type PartnerOrderRow,
  type PartnerOrdersQuery,
} from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { fmtDate } from '@/data/map';
import s from './screen.module.css';
import styles from './Partners.module.css';

const PAGE_SIZE = 25;
// The Update column has to fit 'Out for delivery' plus the chevron.
const COLS = '1.15fr 0.72fr 1.2fr 0.8fr 1.3fr 46px 0.8fr 66px';

type Bucket = NonNullable<PartnerOrdersQuery['bucket']>;
const BUCKETS: { value: Bucket; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

// The shipment statuses staff can set. Same list as the manual transit form.
const TRANSIT_STATUSES = [
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
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
export function PartnerOrders({ partnerId }: { partnerId: string }) {
  const { flash } = useToast();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [bucket, setBucket] = useState<Bucket>('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PartnerOrderRow[]>([]);
  const [open, setOpen] = useState<string | null>(null); // expanded row id
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // Debounce the search; any filter change resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);
  useEffect(() => setPage(1), [q, bucket]);

  const { data, state, error, reload } = useAsync(
    () => getPartnerOrders(partnerId, { q: q || undefined, bucket, page, pageSize: PAGE_SIZE }),
    [partnerId, q, bucket, page],
    (d) => d.items.length === 0,
  );
  useEffect(() => {
    if (data) setRows(data.items);
  }, [data]);

  const meta = data?.meta;
  const pageCount = meta?.pageCount ?? 1;
  const filtered = Boolean(q) || bucket !== 'all';
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
        {BUCKETS.map((b) => (
          <Chip key={b.value} label={b.label} active={bucket === b.value} onClick={() => setBucket(b.value)} />
        ))}
      </div>

      <div className={styles.cardTitle}>
        Orders received{meta?.total ? ` · ${meta.total}` : ''}
      </div>
      <p className={styles.cardHint}>
        Set the shipment status or attach a proof of delivery here — both push straight to the partner.
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
          <DataTable cols={COLS} headers={['Order', 'Date', 'Product', 'Status', 'Update', 'ePOD', 'Total', '']}>
            {rows.map((o) => {
              const cancelled = o.status === 'Cancelled';
              const expanded = open === o.id;
              return (
                <div key={o.id}>
                  <Row cols={COLS}>
                    <div className={styles.ordId}>
                      <span>{o.orderNo}</span>
                      {o.externalRef && <span className={s.mono}>{o.externalRef}</span>}
                    </div>
                    <div className={s.muted}>{fmtDate(o.createdAt)}</div>
                    <div className={styles.ordProduct}>
                      {o.items[0]?.name ?? '—'}
                      {o.itemCount > 1 && <span className={s.muted}> +{o.itemCount - 1} more</span>}
                    </div>
                    <div>
                      <StatusPill label={o.status} tone={orderStatusTone[o.status]} />
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
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </DataTable>

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

/**
 * Read-only detail for one row: the item lines, shipping and totals the table
 * can't show. Fulfilment is edited in the row itself, not here, so the same
 * action never exists twice on one screen.
 */
function PartnerOrderDrawer({ order, onClose }: { order: PartnerOrderRow; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Drawer open onClose={onClose} title={order.orderNo} width={460}>
      <div className={styles.pdWrap}>
        <div className={styles.pdHead}>
          <div className={s.muted} style={{ fontSize: 12.5 }}>
            {order.externalRef ? `Ref ${order.externalRef} · ` : ''}
            {fmtDate(order.createdAt)}
          </div>
          <StatusPill label={order.status} tone={orderStatusTone[order.status]} />
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
          <div className={styles.pdSectionTitle}>Fulfilment</div>
          <dl className={styles.pdMeta}>
            <div>
              <dt>Reseller</dt>
              <dd>{order.reseller}</dd>
            </div>
          </dl>
        </div>

        {(order.courier || order.awb || order.dispatchedAt) && (
          <div className={styles.pdSection}>
            <div className={styles.pdSectionTitle}>Shipping</div>
            <dl className={styles.pdMeta}>
              {order.courier && (
                <div>
                  <dt>Courier</dt>
                  <dd>{order.courier}</dd>
                </div>
              )}
              {order.awb && (
                <div>
                  <dt>AWB</dt>
                  <dd>{order.awb}</dd>
                </div>
              )}
              {order.dispatchedAt && (
                <div>
                  <dt>Dispatched</dt>
                  <dd>{fmtDate(order.dispatchedAt)}</dd>
                </div>
              )}
              {order.deliveredAt && (
                <div>
                  <dt>Delivered</dt>
                  <dd>{fmtDate(order.deliveredAt)}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

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
