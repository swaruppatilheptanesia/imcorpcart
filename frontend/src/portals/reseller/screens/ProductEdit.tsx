import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Save, AlertTriangle } from 'lucide-react';
import { Card, Field, Input, Toggle, Button, Skeleton, EmptyState, ProductThumb, StatusPill, useToast } from '@/components';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import {
  getResellerOffer,
  updateResellerOffer,
  getResellerFreeGifts,
  type ResellerOfferRow,
  type ResellerOfferWrite,
} from '../data';
import s from './screen.module.css';
import styles from './ProductEdit.module.css';

// The reseller edits ONLY its own offer (price + stock + gift + active). The
// product master (name / brand / category / MRP / images) is authored by the
// Super Admin and shown read-only here.
export function ProductEdit() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const id = params.get('id');

  const { data, state, error, reload } = useAsync(
    async () => {
      if (!id) return null;
      const [offer, gifts] = await Promise.all([getResellerOffer(id), getResellerFreeGifts()]);
      return { offer, gifts };
    },
    [id],
  );

  if (state === 'loading') {
    return (
      <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
        <Skeleton h={120} />
        <Skeleton h={220} />
      </div>
    );
  }
  if (state === 'error' || !data || !data.offer) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load"
        body={error ?? 'This listing was not found.'}
        action={{ label: 'Back to products', onClick: () => navigate('/reseller/products') }}
      />
    );
  }

  return (
    <OfferForm
      key={data.offer.offerId}
      offer={data.offer}
      gifts={data.gifts}
      onDone={() => navigate('/reseller/products')}
      onReload={reload}
    />
  );
}

function OfferForm({
  offer,
  gifts,
  onDone,
  onReload,
}: {
  offer: ResellerOfferRow;
  gifts: { id: string; title: string; isActive: boolean }[];
  onDone: () => void;
  onReload: () => void;
}) {
  const { flash } = useToast();
  const [epp, setEpp] = useState(String(offer.eppPrice || ''));
  const [smart, setSmart] = useState(offer.smartEppPrice != null ? String(offer.smartEppPrice) : '');
  const [stock, setStock] = useState(String(offer.quantity ?? 0));
  const [freeGiftId, setFreeGiftId] = useState<string | null>(offer.freeGiftId ?? null);
  const [active, setActive] = useState(offer.isActive);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const eppN = Number(epp) || 0;
    if (eppN <= 0) {
      flash('EPP price is required');
      return;
    }
    const body: ResellerOfferWrite = {
      eppPrice: eppN,
      smartEppPrice: smart ? Number(smart) : null,
      quantity: Number(stock) || 0,
      freeGiftId,
      isActive: active,
    };
    setBusy(true);
    try {
      await updateResellerOffer(offer.offerId, body);
      flash('Listing updated');
      onReload();
      onDone();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save your listing');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.grid}>
        <div className={styles.main}>
          <Card pad="lg">
            <div className={s.sectionTitle}>Product</div>
            <div className={styles.masterHead}>
              <ProductThumb g1={offer.image ?? offer.g1} g2={offer.g2} w={52} h={64} />
              <div style={{ minWidth: 0 }}>
                <div className={styles.masterName}>{offer.name}</div>
                <div className={s.muted}>
                  {offer.brand} · {offer.categoryName}
                  {offer.subCategory ? ` · ${offer.subCategory}` : ''}
                </div>
                <div className={styles.masterMeta}>
                  <span className={s.mono}>{offer.sku}</span>
                  <span className={s.muted}>MRP {inr(offer.mrp)}</span>
                  <span className={s.muted}>MOP {offer.mop != null ? inr(offer.mop) : inr(offer.mrp)}</span>
                  <StatusPill
                    label={`Product ${String(offer.productStatus).toLowerCase()}`}
                    tone={offer.productStatus === 'ACTIVE' ? 'success' : 'neutral'}
                  />
                </div>
              </div>
            </div>
            <p className={styles.masterNote}>
              Product details, images and MRP are managed by imcorpcart. You set your selling price and stock below.
            </p>
          </Card>

          <Card pad="lg">
            <div className={s.sectionTitle}>Free gift</div>
            <Field
              label="Attach one of your free gifts"
              hint={gifts.length ? undefined : 'No gifts yet — create one under Coupons & promotions.'}
            >
              <select
                className={styles.textarea}
                style={{ height: 42, resize: 'none' }}
                value={freeGiftId ?? ''}
                onChange={(e) => setFreeGiftId(e.target.value || null)}
              >
                <option value="">No free gift</option>
                {gifts.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                    {g.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            </Field>
          </Card>
        </div>

        <aside className={styles.rail}>
          <Card pad="lg">
            <div className={s.sectionTitle}>Your pricing &amp; stock</div>
            <div className={styles.stack}>
              <Field label="EPP price" hint="Shown to signed-in employees (cheapest seller wins)">
                <Input value={epp} onChange={(e) => setEpp(e.target.value)} prefix="₹" accent inputMode="numeric" />
              </Field>
              <Field label="Smart EPP price" hint="Optional">
                <Input value={smart} onChange={(e) => setSmart(e.target.value)} prefix="₹" inputMode="numeric" />
              </Field>
              <Field label="Stock quantity">
                <Input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" />
              </Field>
              <label className={styles.activeRow}>
                <div>
                  <div className={styles.activeLabel}>Listing active</div>
                  <div className={s.muted} style={{ fontSize: 12 }}>Turn off to stop selling this product.</div>
                </div>
                <Toggle on={active} onClick={() => setActive((v) => !v)} />
              </label>
            </div>
          </Card>
        </aside>
      </div>

      <div className={styles.saveBar}>
        <div className={styles.saveMsg}>
          <span className={styles.saveDot} />
          Editing your listing
        </div>
        <div className={styles.saveActions}>
          <Button variant="secondary" size="sm" onClick={onDone} disabled={busy}>
            Discard
          </Button>
          <Button size="sm" icon={<Save size={14} />} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save listing'}
          </Button>
        </div>
      </div>
    </div>
  );
}
