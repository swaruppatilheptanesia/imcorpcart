import { useRef, useState } from 'react';
import { Upload, FileCheck2 } from 'lucide-react';
import { Button, Field, Input, useToast } from '@/components';
import { uploadResellerEpod } from '@/data/reseller-api';

/**
 * Proof-of-delivery upload for the reseller who actually shipped the parcel.
 *
 * Only offered once the order is Delivered — the server refuses anything
 * earlier, so showing the control before then would only produce an error.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export function fileError(file: File): string | null {
  if (!ALLOWED.includes(file.type)) return 'Upload a PDF or an image (JPG, PNG or WEBP).';
  if (file.size > MAX_BYTES) return 'That file is over the 2 MB limit.';
  return null;
}

export function EpodUpload({
  orderNo,
  delivered,
  hasPod,
  onDone,
}: {
  orderNo: string;
  delivered: boolean;
  hasPod: boolean;
  onDone: () => void;
}) {
  const { flash } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (!delivered) {
    return <p style={{ fontSize: 12.5, color: 'var(--text3)', margin: 0 }}>Available once the order is delivered.</p>;
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const bad = fileError(file);
    if (bad) {
      flash(bad);
      return;
    }
    setBusy(true);
    try {
      await uploadResellerEpod(orderNo, file, note.trim() || undefined);
      flash('Proof of delivery saved');
      setNote('');
      onDone();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {hasPod && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <FileCheck2 size={15} /> A proof of delivery is already on file.
        </div>
      )}
      <Field label="Reason for issue" hint="Optional — only if the proof is disputed or incomplete">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Signature illegible" />
      </Field>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Upload size={14} /> {busy ? 'Uploading…' : hasPod ? 'Replace document' : 'Upload document'}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,image/*"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
}
