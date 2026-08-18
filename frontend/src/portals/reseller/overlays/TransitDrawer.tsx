import { useEffect, useState } from 'react';
import { Drawer, Field, Input, Button, Chip, useToast } from '@/components';
import { updateTransit, type TransitUpdateInput } from '@/data/reseller-api';
import type { ResellerOrderRow } from '../data';

const STATUS_OPTIONS: { label: string; value: TransitUpdateInput['status'] }[] = [
  { label: 'Packed', value: 'PENDING' },
  { label: 'Dispatched', value: 'DISPATCHED' },
  { label: 'In transit', value: 'IN_TRANSIT' },
  { label: 'Out for delivery', value: 'OUT_FOR_DELIVERY' },
  { label: 'Delivered', value: 'DELIVERED' },
];

const COURIERS: { label: string; value: TransitUpdateInput['courierCode'] }[] = [
  { label: 'BlueDart', value: 'BLUEDART' },
  { label: 'Delhivery', value: 'DELHIVERY' },
  { label: 'DTDC', value: 'DTDC' },
  { label: 'Ekart', value: 'EKART' },
  { label: 'India Post', value: 'INDIA_POST' },
];

interface Props {
  open: boolean;
  order: ResellerOrderRow | null;
  onClose: () => void;
  onSaved: () => void;
}

export function TransitDrawer({ open, order, onClose, onSaved }: Props) {
  const { flash } = useToast();
  const [status, setStatus] = useState<TransitUpdateInput['status']>('DISPATCHED');
  const [awb, setAwb] = useState('');
  const [courier, setCourier] = useState<TransitUpdateInput['courierCode'] | undefined>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus((order?.shipmentStatus as TransitUpdateInput['status']) ?? 'DISPATCHED');
    setAwb(order?.awb ?? '');
    setCourier(undefined);
    setNote('');
  }, [open, order]);

  const save = async () => {
    if (!order) return;
    setBusy(true);
    try {
      await updateTransit(order.id, {
        status,
        awbNumber: awb.trim() || undefined,
        courierCode: courier,
        description: note.trim() || undefined,
      });
      flash(`Transit updated → ${STATUS_OPTIONS.find((o) => o.value === status)?.label}`);
      onSaved();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Update transit — ${order?.id ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Update transit'}
          </Button>
        </>
      }
    >
      <Field label="Shipment status">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {STATUS_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label} active={status === o.value} onClick={() => setStatus(o.value)} />
          ))}
        </div>
      </Field>
      <Field label="Courier" hint="Optional">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {COURIERS.map((c) => (
            <Chip
              key={c.value}
              label={c.label}
              active={courier === c.value}
              onClick={() => setCourier((cur) => (cur === c.value ? undefined : c.value))}
            />
          ))}
        </div>
      </Field>
      <Field label="Tracking / AWB number" hint="Optional">
        <Input placeholder="e.g. AWB123456" value={awb} onChange={(e) => setAwb(e.target.value)} />
      </Field>
      <Field label="Note" hint="Shown on the customer's tracking timeline">
        <Input placeholder="e.g. Out for delivery in Bengaluru" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Drawer>
  );
}
