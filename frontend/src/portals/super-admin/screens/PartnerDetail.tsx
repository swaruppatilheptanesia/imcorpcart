import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, RefreshCw, Send, RotateCw, Trash2, Webhook } from 'lucide-react';
import { Button, Card, EmptyState, Field, Input, Segmented, Select, Skeleton, StatusPill, useToast } from '@/components';
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
  type PartnerStatus,
  type PartnerPriceBasis,
} from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import type { SemanticTone } from '@/data/types';
import { CopyRow } from './Partners';
import s from './screen.module.css';
import styles from './Partners.module.css';

const BASE_URL = `${window.location.origin}/partner-api/v1`;
// Docs are served under the /api prefix too, so the Swagger link works in
// production via the reverse proxy that already forwards /api to the backend
// (the bare /partner-api path may not be proxied).
const DOCS_URL = `${window.location.origin}/api/partner-api/v1/docs`;
const webhookTone: Record<string, SemanticTone> = { DELIVERED: 'success', PENDING: 'warning', FAILED: 'error' };

// The Access card is where a partner's webhook URL and IP allowlist are set, and
// where the delivery log is read — set both to false to hide it again.
const SHOW_ACCESS_CARD = true;

// "Webhook secret ending ••…" + Regenerate, in the Integration card.
const SHOW_WEBHOOK_SECRET = true;

export function PartnerDetail() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { flash } = useToast();
  const { data, state, error, reload } = useAsync(
    () => Promise.all([getPartner(id), getPartnerActivity(id), getPartnerWebhooks(id)]),
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

  const [partner, activity, webhooks] = data;

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
          <CommercialsCard partner={partner} onSaved={reload} />
          <ActivityCard activity={activity} />
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
      <p className={styles.cardHint}>Defaults applied when adding products in the Catalogue tab (each product can be overridden there).</p>
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

function ActivityCard({ activity }: { activity: PartnerActivityRow[] }) {
  const rows = activity;
  return (
    <Card pad="lg">
      <div className={styles.cardTitle}>Activity</div>
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
