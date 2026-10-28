import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Trash2, PackagePlus, AlertTriangle, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Checkbox, DataTable, Drawer, EmptyState, Input, ProductThumb, Row, Select, Skeleton, StatusPill, useToast } from '@/components';
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
// Product · Category · MRP/MOP/EPP · Basis · Offer price · Commission · Partner price · actions
const ENTRY_COLS = '2fr 1fr 1.1fr 0.75fr 1fr 0.8fr 1.15fr 72px';
// The list is server-paged (the API caps a page at 100 — asking for more silently
// truncates, which is how the tab used to show "100 products" for a 671-row catalogue).
const PAGE_SIZE = 50;
// The candidates picker can only ever see one page; past that the admin narrows the search.
const CANDIDATE_PAGE = 100;

// Local recompute for instant feedback (mirrors the backend `entryPrice`): the
// manual offer price, when set, replaces the basis-derived base; commission on top.
function baseFor(row: { mrp: number; mop: number; epp: number | null }, basis: PartnerPriceBasis): number {
  if (basis === 'MRP') return row.mrp;
  if (basis === 'MOP') return row.mop;
  return row.epp ?? row.mrp;
}
function partnerPrice(row: { mrp: number; mop: number; epp: number | null }, basis: PartnerPriceBasis, offerPrice: number | null, commissionPct: number): number {
  const base = offerPrice ?? baseFor(row, basis);
  return Math.round(base * (1 + (commissionPct || 0) / 100));
}

export function PartnerCatalogue({ partnerId, defaultBasis, defaultCommission }: { partnerId: string; defaultBasis: PartnerPriceBasis; defaultCommission: number }) {
  const { flash } = useToast();
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  useEffect(() => {
    getCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  // Server-side search / filter / paging (the backend `listCatalogue` already supports all of it).
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);
  useEffect(() => setPage(1), [q, categoryId, subCategory]);

  const { data: catData, state, error, reload } = useAsync(
    () =>
      getPartnerCatalogue(partnerId, {
        q: q || undefined,
        categoryId: categoryId || undefined,
        subCategory: subCategory || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [partnerId, q, categoryId, subCategory, page],
    (d) => d.items.length === 0,
  );
  const [rows, setRows] = useState<CatalogueEntry[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    if (catData) setRows(catData.items);
  }, [catData]);

  const meta = catData?.meta;
  const total = meta?.total ?? 0;
  const pageCount = Math.max(1, meta?.pageCount ?? 1);
  const start = (page - 1) * PAGE_SIZE;
  const filtered = Boolean(q) || Boolean(categoryId);
  // Removing the last row of the last page leaves `page` past the end — snap back.
  useEffect(() => {
    if (meta && page > pageCount) setPage(pageCount);
  }, [meta, page, pageCount]);

  const subOptions = useMemo(() => categories.find((c) => c.id === categoryId)?.children ?? [], [categories, categoryId]);

  return (
    <div className={styles.catWrap}>
      <PickerCard partnerId={partnerId} categories={categories} defaultBasis={defaultBasis} defaultCommission={defaultCommission} onAdded={reload} />

      <div className={styles.cardTitle} style={{ marginTop: 24 }}>
        Catalogue{total ? ` · ${total.toLocaleString('en-IN')} product${total === 1 ? '' : 's'}` : ''}
      </div>
      <div className={styles.cardHint}>
        Set a manual <strong>Offer price</strong> to override the basis for one product; commission is always added on top of whichever applies.
      </div>

      <div className={s.toolbar}>
        <div className={s.search}>
          <Input icon={<Search size={16} />} placeholder="Search name or SKU" value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="Search catalogue" />
        </div>
        <Select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setSubCategory('');
          }}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Select value={subCategory} onChange={(e) => setSubCategory(e.target.value)} disabled={!subOptions.length} aria-label="Filter by sub-category">
          <option value="">{subOptions.length ? 'All sub-categories' : 'No sub-categories'}</option>
          {subOptions.map((sub) => (
            <option key={sub.id} value={sub.name}>{sub.name}</option>
          ))}
        </Select>
        {filtered && (
          <Button
            variant="secondary"
            onClick={() => {
              setQInput('');
              setCategoryId('');
              setSubCategory('');
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {state === 'loading' && rows.length === 0 && <Skeleton h={160} />}
      {state === 'error' && (
        <EmptyState tone="error" icon={<AlertTriangle size={22} />} title="Couldn't load catalogue" body={error ?? ''} action={{ label: 'Retry', onClick: reload }} />
      )}
      {(state === 'live' || state === 'empty') && rows.length === 0 && (
        <div className={s.muted} style={{ padding: '10px 0' }}>
          {filtered ? 'No products in the catalogue match these filters.' : 'No products yet — add some above.'}
        </div>
      )}
      {rows.length > 0 && (
        <DataTable cols={ENTRY_COLS} headers={['Product', 'Category', 'MRP / MOP / EPP', 'Basis', 'Offer price', 'Commission', 'Partner price', '']}>
          {rows.map((r) => (
            <EntryRow
              key={r.id}
              partnerId={partnerId}
              row={r}
              onView={() => setDetailId(r.productId)}
              onChange={(next) => setRows((rs) => rs.map((x) => (x.id === next.id ? next : x)))}
              onRemoved={() => {
                setRows((rs) => rs.filter((x) => x.id !== r.id));
                reload();
              }}
              flash={flash}
            />
          ))}
        </DataTable>
      )}

      {rows.length > 0 && meta && (
        <div className={s.pager}>
          <div className={s.pagerInfo}>
            Showing {(start + 1).toLocaleString('en-IN')}–{Math.min(start + rows.length, total).toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
          </div>
          <div className={s.pagerControls}>
            <button className={s.pageBtn} onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page <= 1} aria-label="Previous page">
              <ChevronLeft size={16} />
            </button>
            <span className={s.pageNum}>
              Page {page} of {pageCount}
            </span>
            <button className={s.pageBtn} onClick={() => setPage((n) => Math.min(pageCount, n + 1))} disabled={page >= pageCount} aria-label="Next page">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {detailId && <ProductDetailDrawer productId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

type EntryPatch = { priceBasis?: PartnerPriceBasis; commissionPct?: number; offerPrice?: number | null };

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
  const [offer, setOffer] = useState(row.offerPrice != null ? String(row.offerPrice) : '');
  // Keep the inputs in step with the row when the server answer (or a rollback) changes it.
  useEffect(() => setCommission(String(row.commissionPct)), [row.commissionPct]);
  useEffect(() => setOffer(row.offerPrice != null ? String(row.offerPrice) : ''), [row.offerPrice]);

  const patch = async (body: EntryPatch) => {
    const prev = row;
    const nextBasis = body.priceBasis ?? row.priceBasis;
    const nextComm = body.commissionPct ?? row.commissionPct;
    const nextOffer = body.offerPrice !== undefined ? body.offerPrice : row.offerPrice;
    // optimistic — rolled back below if the save fails
    onChange({ ...row, priceBasis: nextBasis, commissionPct: nextComm, offerPrice: nextOffer, vendorPrice: partnerPrice(row, nextBasis, nextOffer, nextComm) });
    try {
      const updated = await updateCatalogueEntry(partnerId, row.id, body);
      onChange(updated);
    } catch (e) {
      onChange(prev);
      flash(e instanceof ApiError ? e.message : 'Could not update');
    }
  };

  const commitCommission = () => {
    const v = Number(commission);
    if (Number.isNaN(v) || v < 0 || v > 100) {
      flash('Commission must be between 0 and 100');
      setCommission(String(row.commissionPct));
      return;
    }
    if (v !== row.commissionPct) patch({ commissionPct: v });
  };

  const commitOffer = () => {
    const raw = offer.trim();
    if (raw === '') {
      if (row.offerPrice != null) patch({ offerPrice: null });
      return;
    }
    const v = Number(raw);
    if (Number.isNaN(v) || v <= 0) {
      flash('Offer price must be a positive amount');
      setOffer(row.offerPrice != null ? String(row.offerPrice) : '');
      return;
    }
    if (v !== row.offerPrice) patch({ offerPrice: v });
  };

  const remove = async () => {
    try {
      await removeCatalogueEntry(partnerId, row.id);
      onRemoved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not remove');
    }
  };

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  return (
    <Row cols={ENTRY_COLS}>
      <button type="button" className={styles.entryProductBtn} onClick={onView} title="View product detail">
        <ProductThumb g1={row.image ?? '#dfe3ea'} g2="#b3b9c4" w={34} h={42} />
        <div className={styles.entryName}>
          <span>{row.name}</span>
          <span className={s.mono}>{row.sku}{row.brand ? ` · ${row.brand}` : ''}</span>
        </div>
      </button>
      <div className={styles.entryCat}>
        <span>{row.category}</span>
        {row.subCategory && <span className={s.muted}>{row.subCategory}</span>}
      </div>
      <div className={styles.entryPrices}>
        {inr(row.mrp)} / {inr(row.mop)} / {row.epp != null ? inr(row.epp) : '—'}
      </div>
      <div>
        <Select
          selectSize="sm"
          value={row.priceBasis}
          onChange={(e) => patch({ priceBasis: e.target.value as PartnerPriceBasis })}
          title={row.offerPrice != null ? 'Ignored while a manual offer price is set' : 'Base price the partner price is derived from'}
          aria-label="Price basis"
        >
          {BASES.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </Select>
      </div>
      <div>
        <Input
          inputSize="sm"
          value={offer}
          prefix="₹"
          inputMode="decimal"
          placeholder="—"
          title="Manual offer price (blank = use basis)"
          aria-label="Offer price"
          onChange={(e) => setOffer(e.target.value)}
          onBlur={commitOffer}
          onKeyDown={blurOnEnter}
        />
      </div>
      <div>
        <Input
          inputSize="sm"
          value={commission}
          prefix="%"
          inputMode="decimal"
          aria-label="Commission percent"
          onChange={(e) => setCommission(e.target.value)}
          onBlur={commitCommission}
          onKeyDown={blurOnEnter}
        />
      </div>
      <div className={styles.entryVendor}>
        {inr(row.vendorPrice)}
        {row.offerPrice != null && <span className={styles.manualTag} title="Priced from the manual offer price">manual</span>}
      </div>
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
  categories,
  defaultBasis,
  defaultCommission,
  onAdded,
}: {
  partnerId: string;
  categories: AdminCategory[];
  defaultBasis: PartnerPriceBasis;
  defaultCommission: number;
  onAdded: () => void;
}) {
  const { flash } = useToast();
  const [categoryId, setCategoryId] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<CatalogueCandidate[]>([]);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [basis, setBasis] = useState<PartnerPriceBasis>(defaultBasis);
  const [commission, setCommission] = useState(String(defaultCommission || 0));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const subOptions = useMemo(() => categories.find((c) => c.id === categoryId)?.children ?? [], [categories, categoryId]);

  // Load candidates when a category is chosen (or search typed).
  useEffect(() => {
    if (!categoryId && !q) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getCatalogueCandidates(partnerId, { categoryId: categoryId || undefined, subCategory: subCategory || undefined, q: q || undefined, pageSize: CANDIDATE_PAGE })
      .then((r) => {
        if (cancelled) return;
        setCandidates(r.items);
        setCandidateTotal(r.meta.total);
      })
      .catch(() => !cancelled && setCandidates([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [partnerId, categoryId, subCategory, q]);

  // The server flags what's already in the catalogue (the list itself is paged,
  // so a client-side id set would only know about the visible page).
  const addable = candidates.filter((c) => !c.inCatalogue);
  const truncated = candidateTotal > candidates.length;

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
        const r = await getCatalogueCandidates(partnerId, { categoryId: categoryId || undefined, subCategory: subCategory || undefined, q: q || undefined, pageSize: CANDIDATE_PAGE });
        setCandidates(r.items);
        setCandidateTotal(r.meta.total);
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
        <Select
          block
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
        </Select>
        <Select block value={subCategory} onChange={(e) => setSubCategory(e.target.value)} disabled={!subOptions.length}>
          <option value="">{subOptions.length ? 'All sub-categories' : 'No sub-categories'}</option>
          {subOptions.map((sub) => (
            <option key={sub.id} value={sub.name}>{sub.name}</option>
          ))}
        </Select>
        <div className={s.search}>
          <Input icon={<Search size={16} />} placeholder="Search products" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
      </div>

      <div className={styles.pickerPricing}>
        <span className={s.muted}>Price basis</span>
        <Select selectSize="sm" value={basis} onChange={(e) => setBasis(e.target.value as PartnerPriceBasis)}>
          {BASES.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </Select>
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
          {truncated && (
            <div className={s.muted} style={{ padding: '4px 0 8px' }}>
              Showing the first {candidates.length} of {candidateTotal.toLocaleString('en-IN')} matches — narrow the search, or use “Add all in category”.
            </div>
          )}
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
