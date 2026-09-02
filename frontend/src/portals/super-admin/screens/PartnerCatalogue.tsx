import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Trash2, PackagePlus, AlertTriangle, Eye } from 'lucide-react';
import { Button, Input, Checkbox, DataTable, Row, ProductThumb, Drawer, StatusPill, EmptyState, Skeleton, useToast } from '@/components';
import {
  getCategories,
  getPartnerCatalogue,
  getCatalogueCandidates,
  addPartnerCatalogue,
  updateCatalogueEntry,
  removeCatalogueEntry,
  getProduct,
  type AdminCategory,
  type CatalogueEntry,
  type CatalogueCandidate,
  type PartnerPriceBasis,
} from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { statusLabel, statusTone } from './Products';
import s from './screen.module.css';
import styles from './Partners.module.css';

const BASES: PartnerPriceBasis[] = ['MRP', 'MOP', 'EPP'];
const ENTRY_COLS = '1.9fr 0.8fr 1.1fr 1.1fr 0.7fr 0.8fr 0.9fr 72px';

// Local recompute for instant feedback (mirrors the backend resolver).
function baseFor(row: { mrp: number; mop: number; epp: number | null }, basis: PartnerPriceBasis): number {
  if (basis === 'MRP') return row.mrp;
  if (basis === 'MOP') return row.mop;
  return row.epp ?? row.mrp;
}
function vendorPrice(base: number, commissionPct: number): number {
  return Math.round(base * (1 + (commissionPct || 0) / 100));
}

export function PartnerCatalogue({ partnerId, defaultBasis, defaultCommission }: { partnerId: string; defaultBasis: PartnerPriceBasis; defaultCommission: number }) {
  const { flash } = useToast();
  const { data: catData, state, error, reload } = useAsync(() => getPartnerCatalogue(partnerId, { pageSize: 500 }), [partnerId]);
  const [rows, setRows] = useState<CatalogueEntry[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    if (catData) setRows(catData.items);
  }, [catData]);

  return (
    <div className={styles.catWrap}>
      <PickerCard partnerId={partnerId} defaultBasis={defaultBasis} defaultCommission={defaultCommission} inCatalogueIds={rows.map((r) => r.productId)} onAdded={reload} />

      <div className={styles.cardTitle} style={{ marginTop: 24 }}>
        Catalogue{rows.length ? ` · ${rows.length} product${rows.length === 1 ? '' : 's'}` : ''}
      </div>

      {state === 'loading' && <Skeleton h={160} />}
      {state === 'error' && (
        <EmptyState tone="error" icon={<AlertTriangle size={22} />} title="Couldn't load catalogue" body={error ?? ''} action={{ label: 'Retry', onClick: reload }} />
      )}
      {(state === 'live' || state === 'empty') && rows.length === 0 && (
        <div className={s.muted} style={{ padding: '10px 0' }}>No products yet — add some above.</div>
      )}
      {rows.length > 0 && (
        <DataTable cols={ENTRY_COLS} headers={['Product', 'Brand', 'Category', 'MRP / MOP / EPP', 'Basis', 'Commission', 'Vendor price', '']}>
          {rows.map((r) => (
            <EntryRow
              key={r.id}
              partnerId={partnerId}
              row={r}
              onView={() => setDetailId(r.productId)}
              onChange={(next) => setRows((rs) => rs.map((x) => (x.id === next.id ? next : x)))}
              onRemoved={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
              flash={flash}
            />
          ))}
        </DataTable>
      )}

      {detailId && <ProductDetailDrawer productId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function EntryRow({
  partnerId,
  row,
  onView,
  onChange,
  onRemoved,
  flash,
}: {
  partnerId: string;
  row: CatalogueEntry;
  onView: () => void;
  onChange: (r: CatalogueEntry) => void;
  onRemoved: () => void;
  flash: (m: string) => void;
}) {
  const [commission, setCommission] = useState(String(row.commissionPct));

  const patch = async (body: { priceBasis?: PartnerPriceBasis; commissionPct?: number }) => {
    // optimistic
    const nextBasis = body.priceBasis ?? row.priceBasis;
    const nextComm = body.commissionPct ?? row.commissionPct;
    onChange({ ...row, priceBasis: nextBasis, commissionPct: nextComm, vendorPrice: vendorPrice(baseFor(row, nextBasis), nextComm) });
    try {
      const updated = await updateCatalogueEntry(partnerId, row.id, body);
      onChange(updated);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not update');
    }
  };

  const remove = async () => {
    try {
      await removeCatalogueEntry(partnerId, row.id);
      onRemoved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not remove');
    }
  };

  return (
    <Row cols={ENTRY_COLS}>
      <button type="button" className={styles.entryProductBtn} onClick={onView} title="View product detail">
        <ProductThumb g1={row.image ?? '#dfe3ea'} g2="#b3b9c4" w={34} h={42} />
        <div className={styles.entryName}>
          <span>{row.name}</span>
          <span className={s.mono}>{row.sku}</span>
        </div>
      </button>
      <div className={s.muted}>{row.brand || '—'}</div>
      <div className={styles.entryCat}>
        <span>{row.category}</span>
        {row.subCategory && <span className={s.muted}>{row.subCategory}</span>}
      </div>
      <div className={styles.entryPrices}>
        {inr(row.mrp)} / {inr(row.mop)} / {row.epp != null ? inr(row.epp) : '—'}
      </div>
      <div>
        <select className={styles.selectSm} value={row.priceBasis} onChange={(e) => patch({ priceBasis: e.target.value as PartnerPriceBasis })}>
          {BASES.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>
      <div>
        <Input
          value={commission}
          prefix="%"
          inputMode="numeric"
          onChange={(e) => setCommission(e.target.value)}
          onBlur={() => {
            const v = Number(commission);
            if (!Number.isNaN(v) && v !== row.commissionPct) patch({ commissionPct: v });
          }}
        />
      </div>
      <div className={styles.entryVendor}>{inr(row.vendorPrice)}</div>
      <div className={styles.entryActions}>
        <button className={s.iconBtn} onClick={onView} aria-label="View detail"><Eye size={15} /></button>
        <button className={s.iconBtn} onClick={remove} aria-label="Remove"><Trash2 size={15} /></button>
      </div>
    </Row>
  );
}

// ── Product detail drawer ────────────────────────────────────────────────────

function ProductDetailDrawer({ productId, onClose }: { productId: string; onClose: () => void }) {
  const { data, state, error } = useAsync(() => getProduct(productId), [productId]);
  const [imgIdx, setImgIdx] = useState(0);

  const raw = data?.raw;
  const images = raw?.images ?? [];
  const specRows = raw?.specs?.rows ?? [];

  return (
    <Drawer open onClose={onClose} title="Product detail" width={460}>
      {state === 'loading' && <Skeleton h={320} />}
      {state === 'error' && (
        <EmptyState tone="error" icon={<AlertTriangle size={22} />} title="Couldn't load product" body={error ?? ''} />
      )}
      {raw && (
        <div className={styles.pdWrap}>
          {images.length > 0 ? (
            <div className={styles.pdGallery}>
              <img className={styles.pdMainImg} src={images[imgIdx]?.url} alt={raw.name} />
              {images.length > 1 && (
                <div className={styles.pdThumbs}>
                  {images.map((im, i) => (
                    <button
                      key={im.id}
                      className={i === imgIdx ? styles.pdThumbOn : styles.pdThumb}
                      onClick={() => setImgIdx(i)}
                      aria-label={`Image ${i + 1}`}
                    >
                      <img src={im.url} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <ProductThumb g1={raw.specs?.g1 ?? '#dfe3ea'} g2={raw.specs?.g2 ?? '#b3b9c4'} w={120} h={148} />
          )}

          <div className={styles.pdHead}>
            <div className={styles.pdName}>{raw.name}</div>
            <StatusPill label={statusLabel[data.product.status]} tone={statusTone[data.product.status]} />
          </div>
          <div className={s.mono} style={{ fontSize: 12.5 }}>{raw.sku}</div>

          <dl className={styles.pdMeta}>
            <div><dt>Brand</dt><dd>{raw.brand || '—'}</dd></div>
            <div><dt>Category</dt><dd>{raw.category?.name ?? '—'}{raw.subCategory ? ` › ${raw.subCategory}` : ''}</dd></div>
            <div><dt>MRP / MOP</dt><dd>{raw.mrp != null ? inr(raw.mrp) : '—'} / {raw.mop != null ? inr(raw.mop) : '—'}</dd></div>
            {(raw.hsnCode || raw.gstPercent != null) && (
              <div><dt>HSN / GST</dt><dd>{raw.hsnCode || '—'}{raw.gstPercent != null ? ` · ${raw.gstPercent}%` : ''}</dd></div>
            )}
          </dl>

          {raw.description && (
            <div className={styles.pdSection}>
              <div className={styles.pdSectionTitle}>Description</div>
              <p className={styles.pdText}>{raw.description}</p>
            </div>
          )}

          {specRows.length > 0 && (
            <div className={styles.pdSection}>
              <div className={styles.pdSectionTitle}>Specifications</div>
              <table className={styles.pdSpecs}>
                <tbody>
                  {specRows.map((sr, i) => (
                    <tr key={i}>
                      <td className={s.muted}>{sr.k}</td>
                      <td>{sr.v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {raw.freebieText && (
            <div className={styles.pdSection}>
              <div className={styles.pdSectionTitle}>Freebie</div>
              <p className={styles.pdText}>{raw.freebieText}</p>
            </div>
          )}
          {raw.warrantyText && (
            <div className={styles.pdSection}>
              <div className={styles.pdSectionTitle}>Warranty</div>
              <p className={styles.pdText}>{raw.warrantyText}</p>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ── Picker ───────────────────────────────────────────────────────────────────

function PickerCard({
  partnerId,
  defaultBasis,
  defaultCommission,
  inCatalogueIds,
  onAdded,
}: {
  partnerId: string;
  defaultBasis: PartnerPriceBasis;
  defaultCommission: number;
  inCatalogueIds: string[];
  onAdded: () => void;
}) {
  const { flash } = useToast();
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<CatalogueCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [basis, setBasis] = useState<PartnerPriceBasis>(defaultBasis);
  const [commission, setCommission] = useState(String(defaultCommission || 0));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCategories().then(setCategories).catch(() => setCategories([]));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const subOptions = useMemo(() => categories.find((c) => c.id === categoryId)?.children ?? [], [categories, categoryId]);
  const inSet = useMemo(() => new Set(inCatalogueIds), [inCatalogueIds]);

  // Load candidates when a category is chosen (or search typed).
  useEffect(() => {
    if (!categoryId && !q) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getCatalogueCandidates(partnerId, { categoryId: categoryId || undefined, subCategory: subCategory || undefined, q: q || undefined, pageSize: 200 })
      .then((r) => !cancelled && setCandidates(r.items))
      .catch(() => !cancelled && setCandidates([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [partnerId, categoryId, subCategory, q]);

  // Candidate availability reflects live catalogue membership (inSet ∪ server flag).
  const addable = candidates.filter((c) => !c.inCatalogue && !inSet.has(c.productId));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const commissionNum = () => {
    const v = Number(commission);
    return Number.isNaN(v) ? 0 : v;
  };

  const add = async (body: Parameters<typeof addPartnerCatalogue>[1], label: string) => {
    setBusy(true);
    try {
      const { added } = await addPartnerCatalogue(partnerId, { priceBasis: basis, commissionPct: commissionNum(), ...body });
      flash(added ? `Added ${added} product${added === 1 ? '' : 's'}` : 'Nothing new to add');
      setSelected(new Set());
      onAdded();
      // refresh candidate flags
      if (categoryId || q) {
        const r = await getCatalogueCandidates(partnerId, { categoryId: categoryId || undefined, subCategory: subCategory || undefined, q: q || undefined, pageSize: 200 });
        setCandidates(r.items);
      }
    } catch (e) {
      flash(e instanceof ApiError ? e.message : `Could not ${label}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.pickerCard}>
      <div className={styles.cardTitle}>Add products</div>
      <div className={styles.pickerControls}>
        <select
          className={styles.select}
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setSubCategory('');
          }}
        >
          <option value="">Select category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className={styles.select} value={subCategory} onChange={(e) => setSubCategory(e.target.value)} disabled={!subOptions.length}>
          <option value="">{subOptions.length ? 'All sub-categories' : 'No sub-categories'}</option>
          {subOptions.map((sub) => (
            <option key={sub.id} value={sub.name}>{sub.name}</option>
          ))}
        </select>
        <div className={s.search} style={{ flex: 1 }}>
          <Search size={16} className={s.searchIcon} />
          <Input className={s.searchInput} placeholder="Search products" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
      </div>

      <div className={styles.pickerPricing}>
        <span className={s.muted}>Price basis</span>
        <select className={styles.selectSm} value={basis} onChange={(e) => setBasis(e.target.value as PartnerPriceBasis)}>
          {BASES.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <span className={s.muted}>Commission</span>
        <div style={{ width: 90 }}>
          <Input value={commission} prefix="%" inputMode="numeric" onChange={(e) => setCommission(e.target.value)} />
        </div>
        {categoryId && (
          <>
            <Button variant="secondary" onClick={() => add({ categoryId }, 'add category')} disabled={busy}>
              <PackagePlus size={14} /> Add all in category
            </Button>
            {subCategory && (
              <Button variant="secondary" onClick={() => add({ categoryId, subCategory }, 'add sub-category')} disabled={busy}>
                <PackagePlus size={14} /> Add all in sub-category
              </Button>
            )}
          </>
        )}
      </div>

      {loading ? (
        <Skeleton h={120} />
      ) : !categoryId && !q ? (
        <div className={s.muted} style={{ padding: '8px 0' }}>Pick a category or search to list products.</div>
      ) : addable.length === 0 ? (
        <div className={s.muted} style={{ padding: '8px 0' }}>No products to add here (all already in the catalogue).</div>
      ) : (
        <>
          <div className={styles.pickerListHead}>
            <button className={styles.linkBtn} onClick={() => setSelected(new Set(addable.map((c) => c.productId)))}>Select all ({addable.length})</button>
            {selected.size > 0 && <button className={styles.linkBtn} onClick={() => setSelected(new Set())}>Clear</button>}
            <div className={s.spacer} />
            <Button onClick={() => add({ productIds: [...selected] }, 'add products')} disabled={busy || selected.size === 0}>
              <Plus size={14} /> Add selected ({selected.size})
            </Button>
          </div>
          <ul className={styles.pickerList}>
            {addable.map((c) => (
              <li key={c.productId} className={styles.pickerItem} onClick={() => toggle(c.productId)}>
                <Checkbox checked={selected.has(c.productId)} onClick={() => toggle(c.productId)} />
                <ProductThumb g1={c.image ?? '#dfe3ea'} g2="#b3b9c4" w={30} h={38} />
                <div className={styles.pickerItemName}>
                  <span>{c.name}</span>
                  <span className={s.mono}>{c.sku} · {c.subCategory || c.category}</span>
                </div>
                <div className={styles.pickerItemPrice}>
                  MRP {inr(c.mrp)} · MOP {inr(c.mop)} · EPP {c.epp != null ? inr(c.epp) : '—'}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
