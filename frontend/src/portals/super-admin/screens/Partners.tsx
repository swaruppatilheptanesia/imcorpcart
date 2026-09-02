import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plug, Plus, Copy, Check, AlertTriangle, KeyRound } from 'lucide-react';
import { Button, DataTable, Row, StatusPill, Field, Input, Modal, EmptyState, Skeleton, useToast } from '@/components';
import type React from 'react';
import { getPartners, createPartner, type PartnerCredentials } from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import type { SemanticTone } from '@/data/types';
import s from './screen.module.css';
import styles from './Partners.module.css';

const COLS = '1.3fr 1.4fr 0.9fr 0.8fr 0.8fr 90px';

export const statusTone: Record<string, SemanticTone> = {
  ACTIVE: 'success',
  ONBOARDING: 'warning',
  SUSPENDED: 'neutral',
};

export function Partners() {
  const navigate = useNavigate();
  const { data, state, error, reload } = useAsync(() => getPartners(), [], (d) => d.length === 0);
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<PartnerCredentials | null>(null);

  return (
    <div>
      <div className={s.toolbar}>
        <div className={s.spacer} />
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} /> Add partner
        </Button>
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load partners"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<Plug size={24} />}
          title="No integration partners yet"
          body="Add a partner to issue API credentials and let a vendor list your catalogue and send you orders."
          action={{ label: 'Add partner', onClick: () => setCreating(true) }}
        />
      )}

      {state === 'live' && data && (
        <DataTable cols={COLS} headers={['Partner', 'API key', 'Scope', 'Commission', 'Webhook', '']}>
          {data.map((p) => (
            <Row key={p.id} cols={COLS} onClick={() => navigate(`/super-admin/partnerDetail/${p.id}`)}>
              <div className={styles.nameCell}>
                <div className={styles.name}>{p.name}</div>
                <StatusPill label={p.active ? p.status : 'Disabled'} tone={p.active ? statusTone[p.status] : 'neutral'} />
              </div>
              <div className={styles.key}>{p.apiKey}</div>
              <div className={s.muted}>
                {p.catalogScope?.categorySlugs?.length ? `${p.catalogScope.categorySlugs.length} categories` : 'All categories'}
              </div>
              <div className={s.muted}>{p.commissionPct != null ? `${p.commissionPct}%` : '—'}</div>
              <div>
                <span className={p.webhookUrl ? styles.dotOn : styles.dotOff} />
                <span className={s.muted}>{p.webhookUrl ? 'Configured' : 'None'}</span>
              </div>
              <div className={styles.rowActions}>
                <span className={s.muted}>{p._count?.orders ?? 0} orders</span>
              </div>
            </Row>
          ))}
        </DataTable>
      )}

      {creating && (
        <CreatePartnerModal
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            setCredentials(c);
            reload();
          }}
        />
      )}

      {credentials && <CredentialsModal credentials={credentials} onClose={() => setCredentials(null)} />}
    </div>
  );
}

// ── Create ───────────────────────────────────────────────────────────────────

function CreatePartnerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: PartnerCredentials) => void }) {
  const { flash } = useToast();
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [ips, setIps] = useState('');
  const [scope, setScope] = useState('');
  const [commission, setCommission] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const c = await createPartner({
        name: name.trim(),
        contactEmail: contactEmail.trim() || undefined,
        webhookUrl: webhookUrl.trim() || undefined,
        ipAllowlist: ips.split(',').map((x) => x.trim()).filter(Boolean),
        catalogScope: scope.trim() ? { categorySlugs: scope.split(',').map((x) => x.trim()).filter(Boolean) } : undefined,
        commissionPct: commission ? Number(commission) : undefined,
      });
      onCreated(c);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not create partner');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add integration partner"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={!name.trim() || busy}>{busy ? 'Creating…' : 'Create partner'}</Button>
        </>
      }
    >
      <Field label="Partner name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GenieMart" />
      </Field>
      <Field label="Contact email">
        <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="ops@partner.com" />
      </Field>
      <Field label="Webhook URL (optional)">
        <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://partner.com/hooks/imcorpcart" />
      </Field>
      <div className={s.formRow2}>
        <Field label="IP allowlist (comma-separated)">
          <Input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="Blank = any IP" />
        </Field>
        <Field label="Commission %">
          <Input value={commission} onChange={(e) => setCommission(e.target.value)} inputMode="numeric" placeholder="0" />
        </Field>
      </div>
      <Field label="Catalogue scope — category slugs (optional, blank = all)">
        <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="phones, accessories" />
      </Field>
    </Modal>
  );
}

// ── Credentials (shown once) ─────────────────────────────────────────────────

function CredentialsModal({ credentials, onClose }: { credentials: PartnerCredentials; onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Partner credentials"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className={styles.secretWarn}>
        <AlertTriangle size={16} />
        <span>Copy the secret now — it is shown <strong>once</strong> and cannot be retrieved later. You can rotate it if lost.</span>
      </div>
      <CopyRow label="API key" value={credentials.apiKey} />
      <CopyRow label="Secret" value={credentials.secret} mono icon={<KeyRound size={14} />} />
    </Modal>
  );
}

export function CopyRow({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className={styles.copyRow}>
      <div className={styles.copyLabel}>
        {icon} {label}
      </div>
      <div className={styles.copyValueWrap}>
        <code className={mono ? styles.copyValueMono : styles.copyValue}>{value}</code>
        <button className={styles.copyBtn} onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
    </div>
  );
}
