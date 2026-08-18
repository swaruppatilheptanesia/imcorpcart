import { useState } from 'react';
import { Modal, Field, Input, Button, Toggle, useToast } from '@/components';
import { createResellerFreeGift, updateResellerFreeGift, type ResellerFreeGift } from '../data';
import styles from './FreeGiftModal.module.css';

/** Add/edit a reseller free gift (title + description + active). */
export function FreeGiftModal({
  gift,
  onClose,
  onSaved,
}: {
  gift: ResellerFreeGift | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { flash } = useToast();
  const [title, setTitle] = useState(gift?.title ?? '');
  const [description, setDescription] = useState(gift?.description ?? '');
  const [isActive, setIsActive] = useState(gift?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  const valid = title.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const body = { title: title.trim(), description: description.trim() || undefined, isActive };
    try {
      if (gift) await updateResellerFreeGift(gift.id, body);
      else await createResellerFreeGift(body);
      onSaved();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save free gift');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${gift ? 'Edit' : 'New'} free gift`}
      width={460}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!valid || busy}>{busy ? 'Saving…' : 'Save gift'}</Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label="Gift title" hint="Shown as the free-gift badge on the product">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Free 80W charger + case" />
        </Field>
        <Field label="Description (optional)">
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Extra details about the gift"
            rows={3}
          />
        </Field>
        <div className={styles.activeRow}>
          <div>
            <div className={styles.activeLabel}>Active</div>
            <div className={styles.activeHint}>Inactive gifts stay attached but are marked inactive in the picker.</div>
          </div>
          <Toggle on={isActive} onClick={() => setIsActive((v) => !v)} />
        </div>
      </div>
    </Modal>
  );
}
