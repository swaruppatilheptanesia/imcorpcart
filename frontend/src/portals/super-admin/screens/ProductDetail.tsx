import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Pencil, Plus, Trash2, Check, X } from 'lucide-react';
import { Card, StatusPill, ProductThumb, Button, Input, Skeleton, EmptyState, useToast } from '@/components';
import {
  getProduct,
  getOffers,
  getOfferResellers,
  attachOffer,
  updateOffer,
  removeOffer,
  catLabels,
  type ApiOfferRow,
  type OfferReseller,
} from '@/data/api';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import s from './screen.module.css';
import styles from './ProductDetail.module.css';
import { statusTone, statusLabel } from './Products';

export function ProductDetail() {
  const navigate = useNavigate();
  const { id } = useParams();

  const { data, state, error } = useAsync(() => getProduct(id ?? ''), [id]);

  if (state === 'loading') {
    return (
      <div className={s.wide} style={{ display: 'grid', gap: 12 }}>
        <Skeleton h={60} />
        <Skeleton h={260} />
      </div>
    );
  }
  if (state === 'error' || !data) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load product"
        body={error ?? 'Product not found.'}
        action={{ label: 'Back to products', onClick: () => navigate('/super-admin/products') }}
      />
    );
  }

  const { product, raw } = data;

  return (
    <div className={s.wide}>
      <button className={styles.back} onClick={() => navigate('/super-admin/products')}>
        <ArrowLeft size={16} /> Back to products
      </button>

      <div className={styles.head}>
        <div className={styles.headMain}>
          <ProductThumb g1={product.g1} g2={product.g2} w={56} h={68} />
          <div>
            <div className={styles.name}>{product.name}</div>
            <div className={styles.sub}>
              <span className={s.mono}>{product.sku}</span> · {product.brand || '—'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <StatusPill label={statusLabel[product.status]} tone={statusTone[product.status]} size="md" />
          <Button
            variant="secondary"
            size="sm"
            icon={<Pencil size={14} />}
            onClick={() => navigate(`/super-admin/productEdit?id=${raw.id}`)}
          >
            Edit product
          </Button>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.col}>
          <Card>
            <div className={s.sectionTitle}>Details</div>
            <div className={styles.rows}>
              <Line label="Category" value={raw.category?.name ?? '—'} />
              <Line label="Sub-category" value={catLabels[product.cat] ?? product.cat ?? '—'} />
              <Line label="Colours" value={raw.colorOptions || '—'} />
              <Line label="Variants" value={raw.variantOptions || '—'} />
              {raw.familyKey && (
                <Line
                  label="Variant family"
                  value={`${raw.familyKey} · ${[raw.optionColor, raw.optionVariant].filter(Boolean).join(' / ') || '—'}`}
                />
              )}
              <Line label="MRP (list price)" value={raw.mrp != null ? inr(raw.mrp) : '—'} strong />
              <Line label="MOP (public price)" value={raw.mop != null ? inr(raw.mop) : '—'} />
              <Line label="Date added" value={product.dateAdded} />
            </div>
            {raw.description && (
              <>
                <div className={s.sectionTitle} style={{ marginTop: 18 }}>
                  Description
                </div>
                <p className={styles.desc}>{raw.description}</p>
              </>
            )}
          </Card>
        </div>

        <div className={styles.col}>
          <SellersPanel productId={raw.id} mrp={raw.mrp} />
        </div>
      </div>
    </div>
  );
}

// ─── Sellers / offers management ──────────────────────────────────────────────

function SellersPanel({ productId, mrp }: { productId: string; mrp: number | null }) {
  const { flash } = useToast();
  const { data, state, reload } = useAsync(
    async () => {
      const [offers, resellers] = await Promise.all([getOffers(productId), getOfferResellers()]);
      return { offers, resellers };
    },
    [productId],
  );

  const offers = data?.offers ?? [];
  const resellers = data?.resellers ?? [];
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <div className={styles.sellersHead}>
        <div className={s.sectionTitle} style={{ margin: 0 }}>
          Sellers &amp; prices
        </div>
        {!adding && (
          <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
            Add seller
          </Button>
        )}
      </div>
      <p className={styles.sellersNote}>Each seller sets their own price &amp; stock. The cheapest in-stock offer wins the buy box.</p>

      {state === 'loading' && <Skeleton h={120} />}

      {adding && (
        <AddSellerRow
          productId={productId}
          resellers={resellers}
          existing={offers}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reload();
          }}
          onError={flash}
        />
      )}

      {state !== 'loading' && offers.length === 0 && !adding && (
        <div className={styles.sellersEmpty}>No sellers yet. Add one to make this product buyable.</div>
      )}

      <div className={styles.offerList}>
        {offers.map((o) => (
          <OfferRow key={o.id} productId={productId} offer={o} mrp={mrp} onChanged={reload} onError={flash} />
        ))}
      </div>
    </Card>
  );
}

function sellerName(o: ApiOfferRow): string {
  return o.reseller?.name ?? 'First-party (house)';
}

function AddSellerRow({
  productId,
  resellers,
  existing,
  onCancel,
  onDone,
  onError,
}: {
  productId: string;
  resellers: OfferReseller[];
  existing: ApiOfferRow[];
  onCancel: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const usedHouse = existing.some((o) => o.resellerId === null);
  const usedIds = new Set(existing.map((o) => o.resellerId));
  const [resellerId, setResellerId] = useState<string>('');
  const [epp, setEpp] = useState('');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const eppN = Number(epp) || 0;
    if (eppN <= 0) {
      onError('Enter an EPP price');
      return;
    }
    setBusy(true);
    try {
      await attachOffer(productId, {
        resellerId: resellerId || null,
        eppPrice: eppN,
        quantity: Number(qty) || 0,
        status: 'active',
      });
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add seller');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.addRow}>
      <select className={styles.offerSelect} value={resellerId} onChange={(e) => setResellerId(e.target.value)}>
        {!usedHouse && <option value="">First-party (house)</option>}
        {resellers
          .filter((r) => !usedIds.has(r.id))
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
      </select>
      <Input placeholder="EPP" prefix="₹" value={epp} onChange={(e) => setEpp(e.target.value)} inputMode="numeric" />
      <Input placeholder="Stock" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" />
      <button className={styles.okBtn} onClick={submit} disabled={busy} aria-label="Add">
        <Check size={16} />
      </button>
      <button className={styles.cancelBtn} onClick={onCancel} aria-label="Cancel">
        <X size={16} />
      </button>
    </div>
  );
}

function OfferRow({
  productId,
  offer,
  mrp,
  onChanged,
  onError,
}: {
  productId: string;
  offer: ApiOfferRow;
  mrp: number | null;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [epp, setEpp] = useState(String(offer.eppPrice || ''));
  const [qty, setQty] = useState(String(offer.quantity ?? 0));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const eppN = Number(epp) || 0;
    if (eppN <= 0) {
      onError('EPP price is required');
      return;
    }
    setBusy(true);
    try {
      await updateOffer(productId, offer.id, {
        eppPrice: eppN,
        quantity: Number(qty) || 0,
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not update offer');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeOffer(productId, offer.id);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove offer');
    } finally {
      setBusy(false);
    }
  };

  const outOfStock = offer.quantity <= 0;

  if (editing) {
    return (
      <div className={styles.addRow}>
        <div className={styles.offerSeller}>{sellerName(offer)}</div>
        <Input placeholder="EPP" prefix="₹" value={epp} onChange={(e) => setEpp(e.target.value)} inputMode="numeric" />
        <Input placeholder="Stock" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" />
        <button className={styles.okBtn} onClick={save} disabled={busy} aria-label="Save">
          <Check size={16} />
        </button>
        <button className={styles.cancelBtn} onClick={() => setEditing(false)} aria-label="Cancel">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className={styles.offerRow}>
      <div style={{ minWidth: 0 }}>
        <div className={styles.offerSeller}>{sellerName(offer)}</div>
        <div className={styles.offerMeta}>
          {inr(offer.eppPrice)} · {outOfStock ? 'Out of stock' : `${offer.quantity} in stock`}
          {mrp && offer.eppPrice < mrp ? ` · MRP ${inr(mrp)}` : ''}
        </div>
      </div>
      <StatusPill
        label={offer.isActive && offer.status === 'ACTIVE' && !outOfStock ? 'Live' : 'Off'}
        tone={offer.isActive && offer.status === 'ACTIVE' && !outOfStock ? 'success' : 'neutral'}
      />
      <button className={s.iconBtn} onClick={() => setEditing(true)} aria-label="Edit offer" disabled={busy}>
        <Pencil size={15} />
      </button>
      <button className={s.iconBtn} onClick={remove} aria-label="Remove offer" disabled={busy}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={styles.line}>
      <span className={strong ? styles.lineStrong : styles.lineLabel}>{label}</span>
      <span className={strong ? styles.lineStrong : styles.lineVal}>{value}</span>
    </div>
  );
}
