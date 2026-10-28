import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Search, Send, RotateCw, Trash2, Webhook } from 'lucide-react';
import { Button, Card, Chip, DataTable, EmptyState, Field, Input, Row, Segmented, Select, Skeleton, StatusPill, useToast } from '@/components';
import { PartnerCatalogue } from './PartnerCatalogue';
import { PartnerOrders } from './PartnerOrders';
import {
  getPartner,
  getPartnerActivity,
  getPartnerWebhooks,
  updatePartner,
  deletePartner,
  rotatePartnerToken,
  rotatePartnerWebhookSecret,
  testPartnerWebhook,
  resendPartnerWebhook,
  type AdminPartner,
  type WebhookDeliveryRow,
  type PartnerActivityRow,
  type PartnerActivityQuery,
  type PartnerStatus,
  orderStatusTone,
  type PartnerPriceBasis,
} from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import type { SemanticTone } from '@/data/types';
import { CopyRow } from './Partners';
import s from './screen.module.css';
import styles from './Partners.module.css';

// The URL handed to partners. The whole partner router is mounted under /api
// because production's reverse proxy forwards only /api to the backend.
const BASE_URL = `${window.location.origin}/api/partner-api/v1`;
const DOCS_URL = `${BASE_URL}/docs`;
const webhookTone: Record<string, SemanticTone> = { DELIVERED: 'success', PENDING: 'warning', FAILED: 'error' };

// Hidden, not deleted: flip any flag back to true to show the card again.
// Access = IP allowlist, webhook URL + delivery log. Webhooks are not part of
// the partner contract (it is pull-only), so nothing here is in use.
const SHOW_ACCESS_CARD = false;
// "Webhook secret ending ••…" + Regenerate, in the Integration card (same reason).
const SHOW_WEBHOOK_SECRET = false;
// Default basis + commission. Pricing is set per product on the Catalogue tab
// (basis, commission and the manual offer price), so the defaults are unused.
const SHOW_COMMERCIALS_CARD = false;

export function PartnerDetail() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { flash } = useToast();
  // The delivery log is only fetched while the Access card is shown; Activity
  // fetches its own paged data.
  const { data, state, error, reload } = useAsync(
    () => Promise.all([getPartner(id), SHOW_ACCESS_CARD ? getPartnerWebhooks(id) : Promise.resolve([] as WebhookDeliveryRow[])]),
    [id],
  );
  const [rotated, setRotated] = useState<{ label: string; value: string } | null>(null);
  const [tab, setTab] = useState<'overview' | 'catalogue' | 'orders'>('overview');

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

  const [partner, webhooks] = data;

  // Status is the single control: Active enables the partner (auth gate needs
  // active && status === ACTIVE), Onboarding/Suspended disable it. We keep the
  // `active` flag in sync so no separate toggle is needed.
  const setPartnerStatus = async (next: PartnerStatus) => {
    try {
      await updatePartner(id, { status: next, active: next === 'ACTIVE' });
      flash(next === 'ACTIVE' ? 'Partner activated' : `Status set to ${next.toLowerCase()}`);
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not update status');
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
          <Segmented
            options={[
              { value: 'ONBOARDING', label: 'Onboarding' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'SUSPENDED', label: 'Suspended' },
            ]}
            value={partner.status}
            onChange={(v) => setPartnerStatus(v as PartnerStatus)}
          />
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
            { value: 'orders', label: 'Orders' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'overview' && (
        <div className={styles.detailGrid}>
          <IntegrationCard partner={partner} onRotateToken={rotateToken} onRotateWebhook={rotateWebhook} />
          {SHOW_ACCESS_CARD && <AccessCard partner={partner} webhooks={webhooks} onSaved={reload} onReloadWebhooks={reload} />}
          {SHOW_COMMERCIALS_CARD && <CommercialsCard partner={partner} onSaved={reload} />}
          <ActivityCard partnerId={id} />
        </div>
      )}
      {tab === 'catalogue' && (
        <PartnerCatalogue partnerId={id} defaultBasis={partner.priceField} defaultCommission={partner.commissionPct ?? 0} />
      )}
      {tab === 'orders' && <PartnerOrders partnerId={id} />}

      {rotated && (
        <SecretModal label={rotated.label} value={rotated.value} onClose={() => setRotated(null)} />
      )}
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
      <a href={DOCS_URL} target="_blank" rel="noreferrer" className={s.muted} style={{ fontSize: 12.5, display: 'inline-block', margin: '2px 2px 8px', textDecoration: 'underline' }}>
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
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updatePartner(partner.id, {
        priceField: basis,
        commissionPct: commission ? Number(commission) : undefined,
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
      <p className={styles.cardHint}>Defaults applied when adding products in the Catalogue tab (each product can be overridden there). A manual Offer price on a product replaces the basis; commission still applies on top.</p>
      <div className={s.formRow2}>
        <Field label="Default price basis">
          <Select block value={basis} onChange={(e) => setBasis(e.target.value as PartnerPriceBasis)}>
            <option value="MRP">MRP</option>
            <option value="MOP">MOP</option>
            <option value="EPP">EPP (cheapest offer)</option>
          </Select>
        </Field>
        <Field label="Default commission %">
          <Input value={commission} onChange={(e) => setCommission(e.target.value)} inputMode="numeric" placeholder="0" />
        </Field>
      </div>
      <div className={styles.cardFoot}>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Card>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────

const ACTIVITY_PAGE = 25;
const EVENT_CHIPS: { value: NonNullable<PartnerActivityQuery['event']>; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'order', label: 'Orders accepted' },
  { value: 'auth_fail', label: 'Auth failures' },
];
const PERIODS: { value: NonNullable<PartnerActivityQuery['period']>; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];
// Date and time · Event · Partner ref · Our order · Status · Items · Value.
// Fixed pixel widths sized to their content (the DataTable grid adds an 18px
// gap between columns), so a cell can never spill into its neighbour; only
// Partner ref flexes, and truncates with an ellipsis when it runs out of room.
const ACT_COLS = '140px 120px minmax(120px, 1fr) 140px 100px 48px 96px';

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function ActivityCard({ partnerId }: { partnerId: string }) {
  const navigate = useNavigate();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [event, setEvent] = useState<NonNullable<PartnerActivityQuery['event']>>('all');
  const [period, setPeriod] = useState<NonNullable<PartnerActivityQuery['period']>>('all');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);
  useEffect(() => setPage(1), [q, event, period]);

  const { data, state, error, reload } = useAsync(
    () => getPartnerActivity(partnerId, { q: q || undefined, event, period, page, pageSize: ACTIVITY_PAGE }),
    [partnerId, q, event, period, page],
    (d) => d.items.length === 0,
  );
  const rows: PartnerActivityRow[] = data?.items ?? [];
  const meta = data?.meta;
  const total = meta?.total ?? 0;
  const pageCount = Math.max(1, meta?.pageCount ?? 1);
  const start = (page - 1) * ACTIVITY_PAGE;
  const filtered = Boolean(q) || event !== 'all' || period !== 'all';

  return (
    <Card pad="lg">
      <div className={styles.actHead}>
        <div className={styles.cardTitle}>Activity{total ? ` · ${total.toLocaleString('en-IN')}` : ''}</div>
        <button className={styles.refreshBtn} onClick={reload} aria-label="Refresh activity"><RefreshCw size={14} /></button>
      </div>
      <p className={styles.cardHint}>Orders this partner placed through the API, and requests we refused at authentication.</p>

      <div className={s.toolbar}>
        <div className={s.search}>
          <Input icon={<Search size={16} />} placeholder="Partner ref or order no" value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="Search activity" />
        </div>
        {EVENT_CHIPS.map((c) => (
          <Chip key={c.value} label={c.label} active={event === c.value} onClick={() => setEvent(c.value)} />
        ))}
        <Select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} aria-label="Period">
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>
      </div>

      {state === 'loading' && rows.length === 0 && <Skeleton h={140} />}
      {state === 'error' && (
        <EmptyState tone="error" icon={<AlertTriangle size={22} />} title="Couldn't load activity" body={error ?? ''} action={{ label: 'Retry', onClick: reload }} />
      )}
      {(state === 'live' || state === 'empty') && rows.length === 0 && (
        <div className={s.muted} style={{ padding: '8px 0' }}>{filtered ? 'No activity matches these filters.' : 'No recorded activity yet.'}</div>
      )}

      {rows.length > 0 && (
        <div className={styles.actScroll}>
        <DataTable cols={ACT_COLS} headers={['Date and time', 'Event', 'Partner ref', 'Our order', 'Status', 'Items', 'Value']}>
          {rows.map((a) => {
            const value = a.orders.reduce((sum, o) => sum + (o.total ?? 0), 0);
            const items = a.orders.reduce((sum, o) => sum + (o.items ?? 0), 0);
            const known = a.orders.some((o) => o.total != null);
            return (
              <Row key={a.id} cols={ACT_COLS}>
                <div className={styles.actWhen}>{fmtWhen(a.createdAt)}</div>
                <div>
                  {a.event === 'auth_fail' ? (
                    <span title={a.reason ?? undefined}>
                      <StatusPill label="Auth failed" tone="error" />
                    </span>
                  ) : a.event === 'order' ? (
                    <StatusPill label="Order accepted" tone="success" />
                  ) : (
                    <span className={s.mono}>{a.event}</span>
                  )}
                </div>
                <div className={styles.actMono} title={a.externalRef ?? undefined}>{a.externalRef ?? '—'}</div>
                <div className={styles.actOrders}>
                  {a.orders.length === 0
                    ? '—'
                    : a.orders.map((o) =>
                        o.id ? (
                          <button key={o.orderNo} className={styles.actOrderLink} onClick={() => navigate(`/super-admin/orderDetail/${o.id}`)}>
                            {o.orderNo}
                          </button>
                        ) : (
                          <span key={o.orderNo} className={styles.actMono} title="This order no longer exists">{o.orderNo}</span>
                        ),
                      )}
                </div>
                {/* One status per order, aligned with the order numbers beside it. */}
                <div className={styles.actOrders}>
                  {a.orders.some((o) => o.status)
                    ? a.orders.map((o) =>
                        o.status ? <StatusPill key={o.orderNo} label={o.status} tone={orderStatusTone[o.status]} /> : <span key={o.orderNo} className={s.muted}>—</span>,
                      )
                    : <span className={s.muted}>—</span>}
                </div>
                <div className={styles.actNum}>{known ? items : '—'}</div>
                <div className={styles.actNum}>{known ? inr(value) : '—'}</div>
              </Row>
            );
          })}
        </DataTable>
        </div>
      )}

      {rows.length > 0 && meta && (
        <div className={s.pager}>
          <div className={s.pagerInfo}>
            Showing {(start + 1).toLocaleString('en-IN')}–{Math.min(start + rows.length, total).toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
          </div>
          <div className={s.pagerControls}>
            <button className={s.pageBtn} onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page <= 1} aria-label="Previous page">
              <ChevronLeft size={16} />
            </button>
            <span className={s.pageNum}>Page {page} of {pageCount}</span>
            <button className={s.pageBtn} onClick={() => setPage((n) => Math.min(pageCount, n + 1))} disabled={page >= pageCount} aria-label="Next page">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </Card>
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
