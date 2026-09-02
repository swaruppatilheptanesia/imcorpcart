import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, RefreshCw, Send, RotateCw, Trash2, Webhook } from 'lucide-react';
import { Card, Button, Field, Input, Toggle, StatusPill, EmptyState, Skeleton, useToast } from '@/components';
import {
  getPartner,
  getPartnerWebhooks,
  getPartnerActivity,
  updatePartner,
  deletePartner,
  rotatePartnerSecret,
  testPartnerWebhook,
  resendPartnerWebhook,
  type AdminPartner,
  type WebhookDeliveryRow,
  type PartnerActivityRow,
  type PartnerStatus,
} from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import type { SemanticTone } from '@/data/types';
import { statusTone, CopyRow } from './Partners';
import s from './screen.module.css';
import styles from './Partners.module.css';

const BASE_URL = `${window.location.origin}/partner-api/v1`;
const webhookTone: Record<string, SemanticTone> = { DELIVERED: 'success', PENDING: 'warning', FAILED: 'error' };

export function PartnerDetail() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { flash } = useToast();
  const { data, state, error, reload } = useAsync(
    () => Promise.all([getPartner(id), getPartnerWebhooks(id), getPartnerActivity(id)]),
    [id],
  );
  const [newSecret, setNewSecret] = useState<string | null>(null);

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

  const [partner, webhooks, activity] = data;

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

  const rotate = async () => {
    if (!window.confirm('Regenerate the signing secret? The current secret stops working immediately.')) return;
    try {
      const { secret } = await rotatePartnerSecret(id);
      setNewSecret(secret);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not rotate secret');
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

      <div className={styles.detailGrid}>
        <IntegrationCard partner={partner} onRotate={rotate} />
        <AccessCard partner={partner} webhooks={webhooks} onSaved={reload} onReloadWebhooks={reload} />
        <CommercialsCard partner={partner} onSaved={reload} />
        <ActivityCard activity={activity} />
      </div>

      {newSecret && (
        <SecretModal secret={newSecret} onClose={() => setNewSecret(null)} />
      )}
    </div>
  );
}

// ── Integration (hand-to-vendor) ─────────────────────────────────────────────

function IntegrationCard({ partner, onRotate }: { partner: AdminPartner; onRotate: () => void }) {
  return (
    <Card pad="lg">
      <div className={styles.cardTitle}>Integration</div>
      <p className={styles.cardHint}>Share these with the vendor. Requests are signed with the secret (shown once).</p>
      <CopyRow label="Base URL" value={BASE_URL} mono />
      <CopyRow label="API key" value={partner.apiKey} mono />
      <div className={styles.signBox}>
        <div className={styles.signTitle}>Request signing</div>
        <p className={styles.signText}>
          Send headers <code>X-Api-Key</code>, <code>X-Timestamp</code> (unix seconds), and{' '}
          <code>X-Signature</code> = HMAC-SHA256(secret, <code>{'`${timestamp}.${rawBody}`'}</code>) as hex. Order posts
          also need an <code>Idempotency-Key</code>.
        </p>
      </div>
      <div className={styles.cardFoot}>
        <span className={s.muted}>Secret ending ••{partner.secretLast4 ?? '????'}</span>
        <Button variant="secondary" onClick={onRotate}>
          <RotateCw size={14} /> Regenerate secret
        </Button>
      </div>
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
  const [scope, setScope] = useState((partner.catalogScope?.categorySlugs ?? []).join(', '));
  const [commission, setCommission] = useState(partner.commissionPct != null ? String(partner.commissionPct) : '');
  const [status, setStatus] = useState<PartnerStatus>(partner.status);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updatePartner(partner.id, {
        catalogScope: scope.trim() ? { categorySlugs: scope.split(',').map((x) => x.trim()).filter(Boolean) } : null,
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
      <div className={styles.cardTitle}>Catalogue &amp; commercials</div>
      <Field label="Catalogue scope — category slugs (blank = all)">
        <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="phones, accessories" />
      </Field>
      <div className={s.formRow2}>
        <Field label="Price field">
          <Input value="MOP" disabled />
        </Field>
        <Field label="Commission %">
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

function ActivityCard({ activity }: { activity: PartnerActivityRow[] }) {
  return (
    <Card pad="lg">
      <div className={styles.cardTitle}>Activity</div>
      {activity.length === 0 ? (
        <div className={s.muted} style={{ padding: '8px 0' }}>No recorded activity yet.</div>
      ) : (
        <ul className={styles.actList}>
          {activity.slice(0, 12).map((a) => (
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

function SecretModal({ secret, onClose }: { secret: string; onClose: () => void }) {
  return (
    <div className={styles.secretOverlay} onClick={onClose}>
      <div className={styles.secretCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.secretWarn}>
          <AlertTriangle size={16} />
          <span>New secret — copy it now, it won't be shown again.</span>
        </div>
        <CopyRow label="Secret" value={secret} mono />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
