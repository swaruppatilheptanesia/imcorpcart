import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, RefreshCw, Send, RotateCw, Trash2, Webhook, Eye, ShoppingBag } from 'lucide-react';
import { Card, Button, Field, Input, Toggle, Segmented, StatusPill, DataTable, Row, ProductThumb, Drawer, EmptyState, Skeleton, useToast } from '@/components';
import { PartnerCatalogue } from './PartnerCatalogue';
import {
  getPartner,
  getPartnerActivity,
  getPartnerOrders,
  updatePartner,
  deletePartner,
  rotatePartnerToken,
  rotatePartnerWebhookSecret,
  testPartnerWebhook,
  resendPartnerWebhook,
  orderStatusTone,
  type AdminPartner,
  type WebhookDeliveryRow,
  type PartnerActivityRow,
  type PartnerOrderRow,
  type PartnerStatus,
  type PartnerPriceBasis,
} from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { fmtDate } from '@/data/map';
import type { SemanticTone } from '@/data/types';
import { statusTone, CopyRow } from './Partners';
import s from './screen.module.css';
import styles from './Partners.module.css';

const BASE_URL = `${window.location.origin}/partner-api/v1`;
const webhookTone: Record<string, SemanticTone> = { DELIVERED: 'success', PENDING: 'warning', FAILED: 'error' };

// Hidden for now — flip to true to bring back the IP allowlist + webhook card.
// When re-enabling, also restore getPartnerWebhooks in the useAsync fetch above.
const SHOW_ACCESS_CARD = false;

// Webhook status-push (#5) isn't wired to a live vendor yet, so the webhook-secret
// controls are hidden (not removed — the rotate handler + backend stay intact).
// Flip to true to show "Webhook secret ending ••…" + Regenerate in the Integration card.
const SHOW_WEBHOOK_SECRET = false;

export function PartnerDetail() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { flash } = useToast();
  const { data, state, error, reload } = useAsync(
    () => Promise.all([getPartner(id), getPartnerActivity(id), getPartnerOrders(id)]),
    [id],
  );
  const [rotated, setRotated] = useState<{ label: string; value: string } | null>(null);
  const [tab, setTab] = useState<'overview' | 'catalogue'>('overview');
  const [orderRow, setOrderRow] = useState<PartnerOrderRow | null>(null);

  if (state === 'loading') {
    return (
      <div className={s.wide} style={{ display: 'grid', gap: 12 }}>
        <Skeleton h={60} />
        <Skeleton h={200} />
      </div>
    );
  }
  if (state === 'error' || !data) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load partner"
        body={error ?? 'Partner not found.'}
        action={{ label: 'Back to partners', onClick: () => navigate('/super-admin/partners') }}
      />
    );
  }

  const [partner, activity, orders] = data;

  const toggleActive = async () => {
    try {
      await updatePartner(id, { active: !partner.active });
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not update');
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete partner "${partner.name}"? Their API access is revoked immediately.`)) return;
    try {
      await deletePartner(id);
      flash('Partner deleted');
      navigate('/super-admin/partners');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not delete');
    }
  };

  const rotateToken = async () => {
    if (!window.confirm('Regenerate the API token? The current token stops working immediately.')) return;
    try {
      const { token } = await rotatePartnerToken(id);
      setRotated({ label: 'New API token', value: token });
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not rotate token');
    }
  };

  const rotateWebhook = async () => {
    if (!window.confirm('Regenerate the webhook secret? The current one stops working immediately.')) return;
    try {
      const { webhookSecret } = await rotatePartnerWebhookSecret(id);
      setRotated({ label: 'New webhook secret', value: webhookSecret });
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not rotate webhook secret');
    }
  };

  return (
    <div className={s.wide}>
      <button className={styles.back} onClick={() => navigate('/super-admin/partners')}>
        <ArrowLeft size={16} /> Back to partners
      </button>

      <div className={styles.detailHead}>
        <div>
          <div className={styles.detailName}>{partner.name}</div>
          <div className={s.muted}>{partner.contactEmail ?? 'No contact email'}</div>
        </div>
        <div className={styles.detailHeadActions}>
          <StatusPill label={partner.active ? partner.status : 'Disabled'} tone={partner.active ? statusTone[partner.status] : 'neutral'} />
          <div className={styles.activeToggle}>
            <span className={s.muted}>Active</span>
            <Toggle on={partner.active} onClick={toggleActive} />
          </div>
          <Button variant="secondary" onClick={remove}>
            <Trash2 size={15} /> Delete
          </Button>
        </div>
      </div>

      <div className={styles.tabsRow}>
        <Segmented
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'catalogue', label: 'Catalogue' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'overview' ? (
        <div className={styles.detailGrid}>
          <IntegrationCard partner={partner} onRotateToken={rotateToken} onRotateWebhook={rotateWebhook} />
          {SHOW_ACCESS_CARD && <AccessCard partner={partner} webhooks={[]} onSaved={reload} onReloadWebhooks={reload} />}
          <OrdersCard orders={orders.items} total={orders.meta.total} onView={setOrderRow} />
          <CommercialsCard partner={partner} onSaved={reload} />
          <ActivityCard activity={activity} />
        </div>
      ) : (
        <PartnerCatalogue partnerId={id} defaultBasis={partner.priceField} defaultCommission={partner.commissionPct ?? 0} />
      )}

      {rotated && (
        <SecretModal label={rotated.label} value={rotated.value} onClose={() => setRotated(null)} />
      )}
      {orderRow && <PartnerOrderDrawer order={orderRow} onClose={() => setOrderRow(null)} />}
    </div>
  );
}

// ── Integration (hand-to-vendor) ─────────────────────────────────────────────

function IntegrationCard({ partner, onRotateToken, onRotateWebhook }: { partner: AdminPartner; onRotateToken: () => void; onRotateWebhook: () => void }) {
  return (
    <Card pad="lg">
      <div className={styles.cardTitle}>Integration</div>
      <p className={styles.cardHint}>Share the base URL + token with the vendor. The token is shown once — keep it server-side only.</p>
      <CopyRow label="Base URL" value={BASE_URL} mono />
      <a href={`${BASE_URL}/docs`} target="_blank" rel="noreferrer" className={s.muted} style={{ fontSize: 12.5, display: 'inline-block', margin: '2px 2px 8px', textDecoration: 'underline' }}>
        Open API docs (Swagger) ↗
      </a>
      <div className={styles.signBox}>
        <div className={styles.signTitle}>Authentication</div>
        <p className={styles.signText}>
          Send one header over HTTPS: <code>Authorization: Bearer &lt;token&gt;</code>. No API key, no signing. Order posts dedupe
          on your own <code>externalRef</code>, so retries are safe.
        </p>
      </div>
      <div className={styles.cardFoot}>
        <span className={s.muted}>Token ending ••{partner.apiTokenLast4 ?? '????'}</span>
        <Button variant="secondary" onClick={onRotateToken}>
          <RotateCw size={14} /> Regenerate token
        </Button>
      </div>
      {SHOW_WEBHOOK_SECRET && (
        <div className={styles.cardFoot}>
          <span className={s.muted}>Webhook secret ending ••{partner.webhookSecretLast4 ?? '????'}</span>
          <Button variant="secondary" onClick={onRotateWebhook}>
            <RotateCw size={14} /> Regenerate webhook secret
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── Access (IP + webhook) ────────────────────────────────────────────────────

function AccessCard({
  partner,
  webhooks,
  onSaved,
  onReloadWebhooks,
}: {
  partner: AdminPartner;
  webhooks: WebhookDeliveryRow[];
  onSaved: () => void;
  onReloadWebhooks: () => void;
}) {
  const { flash } = useToast();
  const [webhookUrl, setWebhookUrl] = useState(partner.webhookUrl ?? '');
  const [ips, setIps] = useState(partner.ipAllowlist.join(', '));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updatePartner(partner.id, {
        webhookUrl: webhookUrl.trim() || null,
        ipAllowlist: ips.split(',').map((x) => x.trim()).filter(Boolean),
      });
      flash('Access updated');
      onSaved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    try {
      await testPartnerWebhook(partner.id);
      flash('Test webhook queued');
      setTimeout(onReloadWebhooks, 1200);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not send test');
    }
  };

  const resend = async (deliveryId: string) => {
    try {
      await resendPartnerWebhook(partner.id, deliveryId);
      flash('Delivery re-queued');
      setTimeout(onReloadWebhooks, 1200);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not resend');
    }
  };

  return (
    <Card pad="lg">
      <div className={styles.cardTitle}>Access</div>
      <Field label="IP allowlist (comma-separated, blank = any)">
        <Input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="Any IP" />
      </Field>
      <Field label="Webhook URL">
        <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://partner.com/hooks" />
      </Field>
      <div className={styles.cardFoot}>
        <Button variant="secondary" onClick={sendTest} disabled={!partner.webhookUrl}>
          <Send size={14} /> Send test
        </Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save access'}</Button>
      </div>

      <div className={styles.subHead}>
        <Webhook size={14} /> Recent deliveries
        <button className={styles.refreshBtn} onClick={onReloadWebhooks} aria-label="Refresh"><RefreshCw size={13} /></button>
      </div>
      {webhooks.length === 0 ? (
        <div className={s.muted} style={{ padding: '8px 0' }}>No webhook deliveries yet.</div>
      ) : (
        <ul className={styles.hookList}>
          {webhooks.slice(0, 8).map((w) => (
            <li key={w.id} className={styles.hookItem}>
              <span className={styles.hookEvent}>{w.event}</span>
              <StatusPill label={w.status} tone={webhookTone[w.status]} />
              <span className={s.muted}>{w.attempts} att · {w.responseStatus ?? w.lastError ?? '—'}</span>
              {w.status !== 'DELIVERED' && (
                <button className={styles.linkBtn} onClick={() => resend(w.id)}>Resend</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Catalogue & commercials ──────────────────────────────────────────────────

function CommercialsCard({ partner, onSaved }: { partner: AdminPartner; onSaved: () => void }) {
  const { flash } = useToast();
  const [basis, setBasis] = useState<PartnerPriceBasis>(partner.priceField);
  const [commission, setCommission] = useState(partner.commissionPct != null ? String(partner.commissionPct) : '');
  const [status, setStatus] = useState<PartnerStatus>(partner.status);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updatePartner(partner.id, {
        priceField: basis,
        commissionPct: commission ? Number(commission) : undefined,
        status,
      });
      flash('Saved');
      onSaved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad="lg">
      <div className={styles.cardTitle}>Commercials</div>
      <p className={styles.cardHint}>Defaults applied when adding products in the Catalogue tab (each product can be overridden there).</p>
      <div className={s.formRow2}>
        <Field label="Default price basis">
          <select className={styles.select} value={basis} onChange={(e) => setBasis(e.target.value as PartnerPriceBasis)}>
            <option value="MRP">MRP</option>
            <option value="MOP">MOP</option>
            <option value="EPP">EPP (cheapest offer)</option>
          </select>
        </Field>
        <Field label="Default commission %">
          <Input value={commission} onChange={(e) => setCommission(e.target.value)} inputMode="numeric" placeholder="0" />
        </Field>
      </div>
      <Field label="Status">
        <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as PartnerStatus)}>
          <option value="ONBOARDING">Onboarding</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
      </Field>
      <div className={styles.cardFoot}>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Card>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────

// Dev-only placeholder so the empty Activity UI is reviewable. Never shown in a
// production build, and only when the partner has no real activity yet.
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
const DEMO_ACTIVITY: PartnerActivityRow[] = [
  { id: 'demo-1', action: 'partner.order.accept', ipAddress: null, after: null, createdAt: ago(12) },
  { id: 'demo-2', action: 'partner.order.accept', ipAddress: null, after: null, createdAt: ago(74) },
  { id: 'demo-3', action: 'partner.auth.fail', ipAddress: '203.0.113.42', after: null, createdAt: ago(190) },
  { id: 'demo-4', action: 'partner.order.accept', ipAddress: null, after: null, createdAt: ago(320) },
  { id: 'demo-5', action: 'partner.auth.fail', ipAddress: '198.51.100.7', after: null, createdAt: ago(1500) },
];

function ActivityCard({ activity }: { activity: PartnerActivityRow[] }) {
  const usingDemo = activity.length === 0 && import.meta.env.DEV;
  const rows = usingDemo ? DEMO_ACTIVITY : activity;
  return (
    <Card pad="lg">
      <div className={styles.cardTitle}>
        Activity
        {usingDemo && <span className={s.muted} style={{ fontWeight: 400, fontSize: 12 }}> · sample data</span>}
      </div>
      {rows.length === 0 ? (
        <div className={s.muted} style={{ padding: '8px 0' }}>No recorded activity yet.</div>
      ) : (
        <ul className={styles.actList}>
          {rows.slice(0, 12).map((a) => (
            <li key={a.id} className={styles.actItem}>
              <span className={styles.actAction}>{a.action.replace('partner.', '')}</span>
              <span className={s.muted}>{new Date(a.createdAt).toLocaleString()}</span>
              {a.ipAddress && <span className={styles.actIp}>{a.ipAddress}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Orders received ──────────────────────────────────────────────────────────

const ORDER_COLS = '1.3fr 0.85fr 1.4fr 1fr 0.95fr 0.9fr 40px';

// Dev-only sample so the empty Orders UI is reviewable (never in production).
const DEMO_ORDERS: PartnerOrderRow[] = [
  {
    id: 'demo-o1', orderNo: 'IMC-84213007', externalRef: 'GM-9921', checkoutGroup: null, status: 'Processing', reseller: 'TechnoReseller',
    subtotal: 3299, total: 3299, itemCount: 1, createdAt: ago(38), dispatchedAt: null, awb: null, courier: null,
    items: [{ name: 'Galaxy A15 5G', sku: 'GP-AN-1000', image: null, qty: 1, unitPrice: 3299, lineTotal: 3299 }],
  },
  {
    id: 'demo-o2', orderNo: 'IMC-84119221', externalRef: 'GM-9907', checkoutGroup: null, status: 'In transit', reseller: 'MobileHub',
    subtotal: 12980, total: 12980, itemCount: 2, createdAt: ago(300), dispatchedAt: ago(90), awb: 'BD1234567', courier: 'Bluedart',
    items: [
      { name: 'Anker PowerCore 20K', sku: 'AC-PC-2000', image: null, qty: 2, unitPrice: 3990, lineTotal: 7980 },
      { name: 'USB-C Cable 100W', sku: 'AC-CB-1010', image: null, qty: 1, unitPrice: 5000, lineTotal: 5000 },
    ],
  },
  {
    id: 'demo-o3', orderNo: 'IMC-83911772', externalRef: 'GM-9880', checkoutGroup: null, status: 'Delivered', reseller: 'First-party',
    subtotal: 74999, total: 74999, itemCount: 1, createdAt: ago(2880), dispatchedAt: ago(2600), awb: 'DL9988776', courier: 'Delhivery',
    items: [{ name: 'Galaxy S24 Ultra', sku: 'GP-SS-9000', image: null, qty: 1, unitPrice: 74999, lineTotal: 74999 }],
  },
];

function OrdersCard({ orders, total, onView }: { orders: PartnerOrderRow[]; total: number; onView: (o: PartnerOrderRow) => void }) {
  const usingDemo = orders.length === 0 && import.meta.env.DEV;
  const rows = usingDemo ? DEMO_ORDERS : orders;
  const count = usingDemo ? DEMO_ORDERS.length : total;
  return (
    <Card pad="lg">
      <div className={styles.cardTitle}>
        Orders received{count ? ` · ${count}` : ''}
        {usingDemo && <span className={s.muted} style={{ fontWeight: 400, fontSize: 12 }}> · sample data</span>}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<ShoppingBag size={22} />} title="No orders received yet" body="Orders this partner posts through the API will appear here." />
      ) : (
        <DataTable cols={ORDER_COLS} headers={['Order', 'Date', 'Product', 'Reseller', 'Status', 'Total', '']}>
          {rows.slice(0, 10).map((o) => (
            <Row key={o.id} cols={ORDER_COLS} onClick={() => onView(o)}>
              <div className={styles.ordId}>
                <span>{o.orderNo}</span>
                {o.externalRef && <span className={s.mono}>{o.externalRef}</span>}
              </div>
              <div className={s.muted}>{fmtDate(o.createdAt)}</div>
              <div className={styles.ordProduct}>
                {o.items[0]?.name ?? '—'}
                {o.itemCount > 1 && <span className={s.muted}> +{o.itemCount - 1} more</span>}
              </div>
              <div className={s.muted}>{o.reseller}</div>
              <div><StatusPill label={o.status} tone={orderStatusTone[o.status]} /></div>
              <div className={s.price}>{inr(o.total)}</div>
              <button className={s.iconBtn} onClick={(e) => { e.stopPropagation(); onView(o); }} aria-label="View order"><Eye size={15} /></button>
            </Row>
          ))}
        </DataTable>
      )}
    </Card>
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

function PartnerOrderDrawer({ order, onClose }: { order: PartnerOrderRow; onClose: () => void }) {
  return (
    <Drawer open onClose={onClose} title={order.orderNo} width={460}>
      <div className={styles.pdWrap}>
        <div className={styles.pdHead}>
          <div className={s.muted} style={{ fontSize: 12.5 }}>
            {order.externalRef ? `Ref ${order.externalRef} · ` : ''}{fmtDate(order.createdAt)}
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
                <div className={styles.ordItemQty}>{it.qty} × {inr(it.unitPrice)}</div>
                <div className={styles.ordItemTotal}>{inr(it.lineTotal)}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.pdSection}>
          <div className={styles.pdSectionTitle}>Fulfilment</div>
          <dl className={styles.pdMeta}>
            <div><dt>Reseller</dt><dd>{order.reseller}</dd></div>
          </dl>
        </div>

        {(order.courier || order.awb || order.dispatchedAt) && (
          <div className={styles.pdSection}>
            <div className={styles.pdSectionTitle}>Shipping</div>
            <dl className={styles.pdMeta}>
              {order.courier && <div><dt>Courier</dt><dd>{order.courier}</dd></div>}
              {order.awb && <div><dt>AWB</dt><dd>{order.awb}</dd></div>}
              {order.dispatchedAt && <div><dt>Dispatched</dt><dd>{fmtDate(order.dispatchedAt)}</dd></div>}
            </dl>
          </div>
        )}

        <div className={styles.pdSection}>
          <div className={styles.pdSectionTitle}>Total</div>
          <OrderLine label="Subtotal" value={inr(order.subtotal)} />
          <OrderLine label="Amount payable" value={inr(order.total)} strong />
        </div>
      </div>
    </Drawer>
  );
}

function SecretModal({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  return (
    <div className={styles.secretOverlay} onClick={onClose}>
      <div className={styles.secretCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.secretWarn}>
          <AlertTriangle size={16} />
          <span>{label} — copy it now, it won't be shown again.</span>
        </div>
        <CopyRow label={label} value={value} mono />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
