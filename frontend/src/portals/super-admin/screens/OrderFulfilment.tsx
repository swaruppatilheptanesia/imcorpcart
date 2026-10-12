import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Truck, Upload, Send, Package, FileText, Download } from 'lucide-react';
import { Button, Field, Input, Select, useToast } from '@/components';
import {
  updateOrderTransit,
  generateOrderAwb,
  refreshOrderTracking,
  uploadOrderEpod,
  resendOrderEpod,
  downloadOrderEpod,
} from '@/data/api';
import { ApiError } from '@/data/http';
import type { OrderFulfilmentInfo } from '@/data/types';
import { fmtDate } from '@/data/map';
import s from './screen.module.css';
import styles from './OrderFulfilment.module.css';

// Fulfilment controls shared by the Super Admin order detail page and the
// partner detail page's per-order drawer. Each takes a flat order id plus an
// `onDone` the parent uses to refresh, so they drop into any screen that can
// supply those two.

const SHIPMENT_STATUSES = [
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'RETURNED', label: 'Returned' },
];
const COURIERS = ['BLUEDART', 'DELHIVERY', 'DTDC', 'EKART', 'INDIA_POST'];

// ─── Courier automation ──────────────────────────────────────────────────────
// Sits above the manual transit form rather than replacing it: when the courier
// aggregator is switched off or a call fails, the reason is shown here and staff
// carry on with the form below exactly as before.

const MAX_EPOD_BYTES = 2 * 1024 * 1024;
const EPOD_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const EPOD_ACCEPT = EPOD_TYPES.join(',');

/**
 * Client-side guard, so a 2MB mistake fails instantly instead of after the
 * upload. Shared by the full control and the one-click table cell, which must
 * not disagree about what is acceptable. Returns null when the file is fine.
 */
export function epodFileError(file: File): string | null {
  if (!EPOD_TYPES.includes(file.type)) return 'Only PDF, PNG, JPG or WEBP documents are allowed';
  if (file.size > MAX_EPOD_BYTES) return 'The document must be 2 MB or smaller';
  return null;
}

export function CourierAutomation({
  orderId,
  hasAwb,
  cancelled,
  info,
  onDone,
}: {
  orderId: string;
  hasAwb: boolean;
  cancelled: boolean;
  info?: OrderFulfilmentInfo;
  onDone: () => void;
}) {
  const { flash } = useToast();
  const [busy, setBusy] = useState<'awb' | 'track' | null>(null);
  const [note, setNote] = useState<string | null>(info?.trackingError ?? null);

  if (cancelled) return null;

  const run = async (kind: 'awb' | 'track') => {
    setBusy(kind);
    setNote(null);
    try {
      const r = kind === 'awb' ? await generateOrderAwb(orderId) : await refreshOrderTracking(orderId);
      if (r.ok) {
        flash(kind === 'awb' ? `AWB ${r.awbNo} booked` : r.applied ? `Updated to ${r.mapped}` : 'Tracking is up to date');
        onDone();
      } else {
        // Not a failure of the order — just automation being unavailable. Say so
        // in place, next to the manual form that still works.
        setNote(r.message ?? 'The courier service could not be reached.');
      }
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" size="sm" disabled={busy !== null || hasAwb} onClick={() => run('awb')}>
          <Package size={14} /> {busy === 'awb' ? 'Booking…' : 'Generate AWB (DTDC)'}
        </Button>
        <Button variant="secondary" size="sm" disabled={busy !== null || !hasAwb} onClick={() => run('track')}>
          <RefreshCw size={14} /> {busy === 'track' ? 'Checking…' : 'Refresh tracking'}
        </Button>
      </div>
      <p className={s.muted} style={{ fontSize: 12, margin: 0 }}>
        {hasAwb
          ? info?.lastTrackedAt
            ? `Last checked with the courier ${fmtDate(info.lastTrackedAt)}.`
            : 'Not yet checked with the courier.'
          : 'No AWB yet — book one, or enter it manually below.'}
      </p>
      {info?.labelUrl && (
        <a href={info.labelUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
          Shipping label (PDF) ↗
        </a>
      )}
      {note && (
        <p style={{ fontSize: 12, margin: 0, color: 'var(--warn, var(--text2))' }}>
          {note} You can still update fulfilment manually below.
        </p>
      )}
    </div>
  );
}

// ─── Proof of delivery ───────────────────────────────────────────────────────

export function EpodControl({
  orderId,
  delivered,
  info,
  onDone,
}: {
  orderId: string;
  delivered: boolean;
  info?: OrderFulfilmentInfo;
  onDone: () => void;
}) {
  const { flash } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [capturedAt, setCapturedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const epod = info?.epod ?? null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const bad = epodFileError(file);
    if (bad) {
      flash(bad);
      return;
    }
    setBusy(true);
    try {
      const r = await uploadOrderEpod(orderId, file, capturedAt ? new Date(capturedAt).toISOString() : undefined);
      flash(r.pushedToPartner ? 'Proof of delivery saved and sent to the partner' : 'Proof of delivery saved');
      onDone();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      await resendOrderEpod(orderId);
      flash('Queued for the partner again');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not resend');
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    try {
      await downloadOrderEpod(orderId, epod?.fileName);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not open the document');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {epod ? (
        <div className={styles.docs}>
          <button className={styles.doc} onClick={download}>
            <span className={styles.docLeft}>
              <FileText size={17} />
              {epod.fileName ?? 'Proof of delivery'}
            </span>
            <Download size={16} />
          </button>
          <p className={s.muted} style={{ fontSize: 12, margin: 0 }}>
            Captured {epod.capturedAt ? fmtDate(epod.capturedAt) : '—'} · uploaded {fmtDate(epod.uploadedAt)}
          </p>
        </div>
      ) : (
        <p className={s.muted} style={{ fontSize: 12.5, margin: 0 }}>
          {delivered
            ? 'Upload the courier\u2019s delivery proof (PDF or image, up to 2 MB).'
            : 'Available once the order is delivered.'}
        </p>
      )}

      {delivered && (
        <>
          <Field label="Captured on" hint="When the courier took the proof. Defaults to the delivery time.">
            <Input type="datetime-local" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> {busy ? 'Working…' : epod ? 'Replace document' : 'Upload document'}
            </Button>
            {epod && info?.fromPartner && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={resend}>
                <Send size={14} /> Resend to partner
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={EPOD_ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          {info?.fromPartner && (
            <p className={s.muted} style={{ fontSize: 12, margin: 0 }}>
              Uploading sends this document to the partner automatically.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One-click ePOD for a table cell: download what is there, or upload what isn't.
 *
 * No capture-date field — the server defaults it to the delivery time, which is
 * the right answer for the common case. The full `EpodControl` is still where
 * you set a different one, or replace a document.
 */
export function EpodCell({
  orderId,
  delivered,
  epod,
  onDone,
}: {
  orderId: string;
  delivered: boolean;
  epod: OrderFulfilmentInfo['epod'];
  onDone: () => void;
}) {
  const { flash } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const bad = epodFileError(file);
    if (bad) {
      flash(bad);
      return;
    }
    setBusy(true);
    try {
      const r = await uploadOrderEpod(orderId, file);
      flash(r.pushedToPartner ? 'Proof of delivery saved and sent to the partner' : 'Proof of delivery saved');
      onDone();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const download = async () => {
    try {
      await downloadOrderEpod(orderId, epod?.fileName);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not open the document');
    }
  };

  if (epod) {
    return (
      <button className={s.iconBtn} onClick={download} title={`Proof of delivery · captured ${epod.capturedAt ? fmtDate(epod.capturedAt) : '—'}`} aria-label="Download proof of delivery">
        <FileText size={15} />
      </button>
    );
  }
  if (!delivered) {
    return <span className={s.muted} title="Available once the order is delivered">—</span>;
  }
  return (
    <>
      <button className={s.iconBtn} disabled={busy} onClick={() => fileRef.current?.click()} title="Upload proof of delivery" aria-label="Upload proof of delivery">
        <Upload size={15} />
      </button>
      <input ref={fileRef} type="file" accept={EPOD_ACCEPT} style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
    </>
  );
}

export function TransitControl({
  orderId,
  cancelled,
  defaultCourier,
  currentAwb,
  currentStatus,
  onDone,
}: {
  orderId: string;
  cancelled: boolean;
  /** The product's assigned courier, pre-selected but freely overridable. */
  defaultCourier?: string;
  /** The AWB already on the shipment, so re-saving doesn't blank it. */
  currentAwb?: string | null;
  /** The shipment's current status, where the caller knows it. Without this the
   *  form would open on 'Dispatched' and contradict the status shown beside it. */
  currentStatus?: string | null;
  onDone: () => void;
}) {
  const { flash } = useToast();
  const [status, setStatus] = useState(currentStatus ?? 'DISPATCHED');
  const [awb, setAwb] = useState(currentAwb ?? '');
  const [courier, setCourier] = useState(defaultCourier ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Re-seed when the order changes. On the detail page this fires once, but in
  // the partner drawer the same mounted control is reused for the next row, so
  // without this it would keep the previous order's AWB and courier.
  useEffect(() => {
    setStatus(currentStatus ?? 'DISPATCHED');
    setAwb(currentAwb ?? '');
    setCourier(defaultCourier ?? '');
    setNote('');
  }, [orderId, currentAwb, currentStatus, defaultCourier]);

  if (cancelled) {
    return <p className={s.muted} style={{ fontSize: 12.5 }}>This order is cancelled — fulfilment is closed.</p>;
  }

  const submit = async () => {
    setBusy(true);
    try {
      await updateOrderTransit(orderId, {
        status,
        awbNumber: awb.trim() || undefined,
        courierCode: courier || undefined,
        description: note.trim() || undefined,
      });
      flash('Fulfilment status updated');
      onDone();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p className={s.muted} style={{ fontSize: 12.5, margin: 0 }}>
        You handle fulfilment for this order — set the shipment status (drives the customer's tracking timeline).
      </p>
      <Field label="Status">
        <Select block value={status} onChange={(e) => setStatus(e.target.value)}>
          {SHIPMENT_STATUSES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Courier">
          <Select block value={courier} onChange={(e) => setCourier(e.target.value)}>
            <option value="">—</option>
            {COURIERS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="AWB / tracking no.">
          <Input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <Field label="Note (optional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown on the tracking event" />
      </Field>
      <Button onClick={submit} disabled={busy}>
        <Truck size={15} /> {busy ? 'Updating…' : 'Update fulfilment'}
      </Button>
    </div>
  );
}

