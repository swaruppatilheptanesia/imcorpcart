import { useEffect, useState } from 'react';
import { Plus, Pencil, QrCode, AlertTriangle, Users, ShoppingBag, Copy, Download } from 'lucide-react';
import QRCode from 'qrcode';
import { Button, Card, StatusPill, Field, Input, Modal, Skeleton, EmptyState, useToast } from '@/components';
import { useAsync } from '@/lib/useAsync';
import {
  getCampaigns,
  createCampaign,
  updateCampaign,
  getCategories,
  type AdminCampaign,
  type AdminCategory,
  type CampaignDiscountMode,
  type CampaignStatus,
} from '@/data/api';
import { ApiError } from '@/data/http';
import { fmtDate } from '@/data/map';
import s from './screen.module.css';
import styles from './QrCampaigns.module.css';

const MODE_LABEL: Record<CampaignDiscountMode, string> = {
  FIRST_ORDER: 'first order only',
  WHILE_ACTIVE: 'while campaign active',
  FOREVER: 'forever',
};

const STATUS_TONE: Record<CampaignStatus, 'success' | 'neutral' | 'warning'> = {
  ACTIVE: 'success',
  DRAFT: 'neutral',
  PAUSED: 'warning',
  ENDED: 'neutral',
};

export function QrCampaigns() {
  const { flash } = useToast();
  const { data, state, error, reload } = useAsync(() => getCampaigns(), [], (d) => d.length === 0);
  const [editing, setEditing] = useState<AdminCampaign | 'new' | null>(null);
  const [qrFor, setQrFor] = useState<AdminCampaign | null>(null);

  const campaigns = data ?? [];

  const setStatus = async (c: AdminCampaign, status: CampaignStatus) => {
    try {
      await updateCampaign(c.id, { status });
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Update failed');
    }
  };

  return (
    <div>
      <div className={s.toolbar}>
        <div className={s.spacer} />
        <Button size="sm" icon={<Plus size={16} strokeWidth={2.2} />} onClick={() => setEditing('new')}>
          New campaign
        </Button>
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} h={104} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load campaigns"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<QrCode size={24} />}
          title="No QR campaigns yet"
          body="Create a campaign, print its QR at your event, and everyone who registers by scanning it gets the configured discount."
          action={{ label: 'New campaign', onClick: () => setEditing('new') }}
        />
      )}

      {state === 'live' && (
        <div className={styles.list}>
          {campaigns.map((c) => (
            <Card key={c.id} pad="lg" className={styles.card}>
              <div className={styles.head}>
                <div className={styles.title}>
                  <span className={styles.name}>{c.name}</span>
                  <span className={styles.pct}>{c.discountPercent}% off</span>
                  <span className={styles.mode}>· {c.category ? `${c.category.name} only` : 'all categories'}</span>
                  <span className={styles.mode}>· {MODE_LABEL[c.discountMode]}</span>
                  <StatusPill label={c.status} tone={STATUS_TONE[c.status]} />
                </div>
                <div className={styles.actions}>
                  <Button size="sm" variant="secondary" icon={<QrCode size={15} />} onClick={() => setQrFor(c)}>
                    Show QR
                  </Button>
                  <button className={s.iconBtn} aria-label="Edit campaign" onClick={() => setEditing(c)}>
                    <Pencil size={16} />
                  </button>
                  {c.status !== 'ACTIVE' && c.status !== 'ENDED' && (
                    <Button size="sm" onClick={() => setStatus(c, 'ACTIVE')}>Activate</Button>
                  )}
                  {c.status === 'ACTIVE' && (
                    <Button size="sm" variant="secondary" onClick={() => setStatus(c, 'PAUSED')}>Pause</Button>
                  )}
                  {c.status !== 'ENDED' && (
                    <Button size="sm" variant="secondary" onClick={() => setStatus(c, 'ENDED')}>End</Button>
                  )}
                </div>
              </div>
              <div className={styles.meta}>
                <span className={styles.metaItem}>
                  {fmtDate(c.startsAt)} → {fmtDate(c.endsAt)}
                </span>
                <span className={styles.metaItem}>
                  <Users size={14} /> {c._count?.users ?? 0} registrations
                </span>
                <span className={styles.metaItem}>
                  <ShoppingBag size={14} /> {c._count?.orders ?? 0} orders
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <CampaignModal
          campaign={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {qrFor && <QrModal campaign={qrFor} onClose={() => setQrFor(null)} />}
    </div>
  );
}

// ─── Create / edit modal ─────────────────────────────────────────────────────

// ISO ↔ <input type="datetime-local"> value (local time, minute precision).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CampaignModal({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: AdminCampaign | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { flash } = useToast();
  const [name, setName] = useState(campaign?.name ?? '');
  const [percent, setPercent] = useState(campaign ? String(campaign.discountPercent) : '');
  const [mode, setMode] = useState<CampaignDiscountMode>(campaign?.discountMode ?? 'FIRST_ORDER');
  const [status, setStatus] = useState<CampaignStatus>(campaign?.status ?? 'DRAFT');
  const [startsAt, setStartsAt] = useState(campaign ? toLocalInput(campaign.startsAt) : '');
  const [endsAt, setEndsAt] = useState(campaign ? toLocalInput(campaign.endsAt) : '');
  const [categoryId, setCategoryId] = useState(campaign?.categoryId ?? '');
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCategories().then(setCategories).catch(() => undefined);
  }, []);

  const pctNum = Number(percent);
  const valid =
    name.trim() &&
    percent !== '' &&
    pctNum >= 0 &&
    pctNum <= 100 &&
    startsAt &&
    endsAt &&
    new Date(endsAt) > new Date(startsAt);

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        discountPercent: pctNum,
        discountMode: mode,
        status,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        categoryId: categoryId || null, // '' = all categories
      };
      if (campaign) await updateCampaign(campaign.id, body);
      else await createCampaign(body);
      onSaved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save campaign');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={campaign ? 'Edit campaign' : 'New QR campaign'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={!valid || busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <Field label="Campaign name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tech Expo Mumbai 2026" />
      </Field>
      <div className={styles.grid2}>
        <Field label="Discount %">
          <Input
            type="number"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            placeholder="10"
          />
        </Field>
        <Field label="Discount lasts">
          <select className={styles.select} value={mode} onChange={(e) => setMode(e.target.value as CampaignDiscountMode)}>
            <option value="FIRST_ORDER">First order only</option>
            <option value="WHILE_ACTIVE">While campaign is active</option>
            <option value="FOREVER">Forever</option>
          </select>
        </Field>
      </div>
      <div className={styles.grid2}>
        <Field label="Starts">
          <input type="datetime-local" className={styles.dt} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label="Ends">
          <input type="datetime-local" className={styles.dt} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
      </div>
      <div className={styles.grid2}>
        <Field label="Category scope">
          <select className={styles.select} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name} only</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus)}>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="ENDED">Ended</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

// ─── QR modal ────────────────────────────────────────────────────────────────

function QrModal({ campaign, onClose }: { campaign: AdminCampaign; onClose: () => void }) {
  const { flash } = useToast();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const url = `${window.location.origin}/?qr=${campaign.qrToken}`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: 480, margin: 2 })
      .then((d) => !cancelled && setDataUrl(d))
      .catch(() => !cancelled && flash('Could not render QR'));
    return () => {
      cancelled = true;
    };
  }, [url, flash]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      flash('Link copied');
    } catch {
      flash('Copy failed — copy the link manually');
    }
  };

  return (
    <Modal open onClose={onClose} title={`${campaign.name} — QR`}>
      <div className={styles.qrWrap}>
        {dataUrl ? <img className={styles.qrImg} src={dataUrl} alt={`QR for ${campaign.name}`} /> : <Skeleton h={240} />}
        <div className={styles.qrLink}>{url}</div>
        <div className={styles.qrBtns}>
          <Button size="sm" variant="secondary" icon={<Copy size={15} />} onClick={copy}>
            Copy link
          </Button>
          {dataUrl && (
            <a href={dataUrl} download={`${campaign.name.replace(/\s+/g, '-').toLowerCase()}-qr.png`}>
              <Button size="sm" icon={<Download size={15} />}>Download PNG</Button>
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}
