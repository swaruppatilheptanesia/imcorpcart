import { useState } from 'react';
import { Modal, Field, Input, Button, Toggle, useToast } from '@/components';
import { createAddress, updateAddress, type AddressInput } from '@/data/shop-api';
import type { ShopAddress } from '@/data/store-types';
import { ApiError } from '@/data/http';
import styles from './AddressModal.module.css';

/** Add/edit a shipping or billing address. Shared by Profile + Checkout.
 *  `onSaved` receives the saved address so callers can auto-select it. */
export function AddressModal({
  address,
  billing,
  onClose,
  onSaved,
}: {
  address: ShopAddress | null;
  billing: boolean;
  onClose: () => void;
  onSaved: (saved: ShopAddress) => void;
}) {
  const { flash } = useToast();
  const [f, setF] = useState({
    contactName: address?.contactName ?? '',
    contactPhone: address?.contactPhone ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    pincode: address?.pincode ?? '',
    label: address?.label ?? '',
    isDefault: address?.isDefault ?? false,
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));

  const pincodeOk = /^\d{6}$/.test(f.pincode);
  const valid =
    f.contactName.trim() && f.contactPhone.trim() && f.line1.trim() && f.city.trim() && f.state.trim() && pincodeOk;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const body: AddressInput = {
      contactName: f.contactName.trim(),
      contactPhone: f.contactPhone.trim(),
      line1: f.line1.trim(),
      line2: f.line2.trim() || undefined,
      city: f.city.trim(),
      state: f.state.trim(),
      pincode: f.pincode.trim(),
      label: f.label.trim() || undefined,
      isBilling: billing,
      isDefault: billing ? false : f.isDefault,
    };
    try {
      const saved = address ? await updateAddress(address.id, body) : await createAddress(body);
      onSaved(saved);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save address');
      setBusy(false);
    }
  };

  const kind = billing ? 'billing' : 'shipping';
  return (
    <Modal
      open
      onClose={onClose}
      title={`${address ? 'Edit' : 'Add'} ${kind} address`}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!valid || busy}>{busy ? 'Saving…' : 'Save address'}</Button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <Field label="Label (optional)">
          <Input value={f.label} onChange={(e) => set({ label: e.target.value })} placeholder="Home, Office…" />
        </Field>
        <div className={styles.formRow}>
          <Field label="Contact name">
            <Input value={f.contactName} onChange={(e) => set({ contactName: e.target.value })} />
          </Field>
          <Field label="Contact phone">
            <Input value={f.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} inputMode="tel" />
          </Field>
        </div>
        <Field label="Address line 1">
          <Input value={f.line1} onChange={(e) => set({ line1: e.target.value })} placeholder="Flat / building / street" />
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
        {!billing && (
          <div className={styles.defaultToggle}>
            <div>
              <div className={styles.toggleLabel}>Set as default</div>
              <div className={styles.toggleHint}>Used for delivery at checkout</div>
            </div>
            <Toggle on={f.isDefault} onClick={() => set({ isDefault: !f.isDefault })} />
          </div>
        )}
      </div>
    </Modal>
  );
}
