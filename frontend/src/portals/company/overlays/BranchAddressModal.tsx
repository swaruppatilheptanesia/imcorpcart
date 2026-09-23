import { useState } from 'react';
import { Modal, Field, Input, Button, Toggle, useToast } from '@/components';
import { createBranch, updateBranch, type BranchInput, type CompanyBranch } from '@/data/company-api';
import { ApiError } from '@/data/http';
import styles from '../../storefront/overlays/AddressModal.module.css';

/** Add/edit a company office branch (Smart EPP delivery point). Mirrors the
 *  storefront AddressModal, with the branch name required. */
export function BranchAddressModal({
  branch,
  onClose,
  onSaved,
}: {
  branch: CompanyBranch | null;
  onClose: () => void;
  onSaved: (saved: CompanyBranch) => void;
}) {
  const { flash } = useToast();
  const [f, setF] = useState({
    label: branch?.label ?? '',
    contactName: branch?.contactName ?? '',
    contactPhone: branch?.contactPhone ?? '',
    line1: branch?.line1 ?? '',
    line2: branch?.line2 ?? '',
    city: branch?.city ?? '',
    state: branch?.state ?? '',
    pincode: branch?.pincode ?? '',
    isDefault: branch?.isDefault ?? false,
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));

  const pincodeOk = /^\d{6}$/.test(f.pincode);
  const valid =
    f.label.trim() && f.contactName.trim() && f.contactPhone.trim() && f.line1.trim() && f.city.trim() && f.state.trim() && pincodeOk;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const body: BranchInput = {
      label: f.label.trim(),
      contactName: f.contactName.trim(),
      contactPhone: f.contactPhone.trim(),
      line1: f.line1.trim(),
      line2: f.line2.trim() || undefined,
      city: f.city.trim(),
      state: f.state.trim(),
      pincode: f.pincode.trim(),
      isDefault: f.isDefault,
    };
    try {
      const saved = branch ? await updateBranch(branch.id, body) : await createBranch(body);
      onSaved(saved);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the branch');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${branch ? 'Edit' : 'Add'} office branch`}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!valid || busy}>{busy ? 'Saving…' : 'Save branch'}</Button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <Field label="Branch name" hint="Shown to employees when they choose a delivery office">
          <Input value={f.label} onChange={(e) => set({ label: e.target.value })} placeholder="Mumbai HQ, Pune office…" />
        </Field>
        <div className={styles.formRow}>
          <Field label="Receiving contact (HR)">
            <Input value={f.contactName} onChange={(e) => set({ contactName: e.target.value })} />
          </Field>
          <Field label="Contact phone">
            <Input value={f.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} inputMode="tel" />
          </Field>
        </div>
        <Field label="Address line 1">
          <Input value={f.line1} onChange={(e) => set({ line1: e.target.value })} placeholder="Building / street" />
        </Field>
        <Field label="Address line 2 (optional)">
          <Input value={f.line2} onChange={(e) => set({ line2: e.target.value })} placeholder="Area / landmark" />
        </Field>
        <div className={styles.formRow3}>
          <Field label="City">
            <Input value={f.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
          <Field label="State">
            <Input value={f.state} onChange={(e) => set({ state: e.target.value })} />
          </Field>
          <Field label="Pincode" error={f.pincode && !pincodeOk ? '6 digits' : undefined}>
            <Input value={f.pincode} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" />
          </Field>
        </div>
        <div className={styles.defaultToggle}>
          <div>
            <div className={styles.toggleLabel}>Default branch</div>
            <div className={styles.toggleHint}>Pre-selected for employees at request time</div>
          </div>
          <Toggle on={f.isDefault} onClick={() => set({ isDefault: !f.isDefault })} />
        </div>
      </div>
    </Modal>
  );
}
