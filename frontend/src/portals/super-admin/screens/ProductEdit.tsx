import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, ImagePlus, AlertTriangle, X, Trash2, Save } from 'lucide-react';
import { Card, Field, Input, Segmented, Chip, Button, Toggle, Skeleton, EmptyState, useToast } from '@/components';
import { useAsync } from '@/lib/useAsync';
import {
  getCategories,
  getProduct,
  getFamilies,
  createProduct,
  updateProduct,
  uploadImage,
  type AdminCategory,
  type ProductInput,
  type ProductShade,
  type ProductSpecRow,
  type RawProductDetail,
} from '@/data/api';
import s from './screen.module.css';
import styles from './ProductEdit.module.css';

function darken(hex: string, factor = 0.6): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function ProductEdit() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const id = params.get('id');

  const { data, state, error, reload } = useAsync(
    async () => {
      const [cats, families, detail] = await Promise.all([
        getCategories(),
        getFamilies(),
        id ? getProduct(id) : Promise.resolve(null),
      ]);
      return { cats, families, detail: detail?.raw ?? null };
    },
    [id],
  );

  if (state === 'loading') {
    return (
      <div style={{ display: 'grid', gap: 12, maxWidth: 880 }}>
        <Skeleton h={120} />
        <Skeleton h={220} />
      </div>
    );
  }
  if (state === 'error' || !data) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load"
        body={error ?? 'Something went wrong.'}
        action={{ label: 'Retry', onClick: reload }}
      />
    );
  }

  return (
    <EditForm
      key={data.detail?.id ?? 'new'}
      categories={data.cats}
      families={data.families}
      product={data.detail}
      onSaved={(pid) => navigate(`/super-admin/productDetail/${pid}`)}
      onCancel={() => navigate(id ? `/super-admin/productDetail/${id}` : '/super-admin/products')}
    />
  );
}

function EditForm({
  categories,
  families,
  product,
  onSaved,
  onCancel,
}: {
  categories: AdminCategory[];
  families: string[];
  product: RawProductDetail | null;
  onSaved: (productId: string) => void;
  onCancel: () => void;
}) {
  const { flash } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? '');
  const [subCategory, setSubCategory] = useState(product?.subCategory ?? '');
  const [status, setStatus] = useState<'active' | 'draft' | 'inactive'>(
    (String(product?.status ?? 'DRAFT').toLowerCase() as 'active' | 'draft' | 'inactive'),
  );
  const [smartEpp, setSmartEpp] = useState(product?.smartEpp ?? false);
  const [mrp, setMrp] = useState(product?.mrp != null ? String(product.mrp) : '');
  const [mop, setMop] = useState(product?.mop != null ? String(product.mop) : '');
  const [cashbackType, setCashbackType] = useState<'NONE' | 'PERCENT' | 'FIXED'>(product?.cashbackType ?? 'NONE');
  const [cashbackValue, setCashbackValue] = useState(product?.cashbackValue != null ? String(product.cashbackValue) : '');
  const [hsnCode, setHsnCode] = useState(product?.hsnCode ?? '');
  const [gstPercent, setGstPercent] = useState(product?.gstPercent != null ? String(product.gstPercent) : '');
  const [warrantyText, setWarrantyText] = useState(product?.warrantyText ?? '');
  const [termsText, setTermsText] = useState(product?.termsText ?? '');
  const [familyKey, setFamilyKey] = useState(product?.familyKey ?? '');
  const [optionColor, setOptionColor] = useState(product?.optionColor ?? '');
  const [optionVariant, setOptionVariant] = useState(product?.optionVariant ?? '');
  const [variants, setVariants] = useState(product?.variantOptions ?? '');
  const [freebieText, setFreebieText] = useState(product?.freebieText ?? '');
  const [shades, setShades] = useState<ProductShade[]>(product?.specs?.shades ?? []);
  const [specRows, setSpecRows] = useState<ProductSpecRow[]>(product?.specs?.rows ?? []);
  const [images, setImages] = useState<{ url: string }[]>(product?.images.map((i) => ({ url: i.url })) ?? []);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);

  const variantList = variants.split(',').map((v) => v.trim()).filter(Boolean);
  const subOptions = categories.find((c) => c.id === categoryId)?.children ?? [];

  const addShade = () => setShades((xs) => [...xs, { name: '', g1: '#4a7fc0', g2: darken('#4a7fc0'), stock: 0 }]);
  const setShade = (i: number, patch: Partial<ProductShade>) =>
    setShades((xs) => xs.map((sh, j) => (j === i ? { ...sh, ...patch } : sh)));
  const removeShade = (i: number) => setShades((xs) => xs.filter((_, j) => j !== i));

  const addSpec = () => setSpecRows((xs) => [...xs, { k: '', v: '' }]);
  const setSpec = (i: number, patch: Partial<ProductSpecRow>) =>
    setSpecRows((xs) => xs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeSpec = (i: number) => setSpecRows((xs) => xs.filter((_, j) => j !== i));

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading((n) => n + files.length);
    for (const file of Array.from(files)) {
      try {
        const url = await uploadImage(file);
        setImages((xs) => [...xs, { url }]);
      } catch (e) {
        flash(e instanceof Error ? e.message : 'Image upload failed');
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const save = async () => {
    if (!name.trim() || !sku.trim() || !categoryId) {
      flash('Name, SKU and category are required');
      return;
    }
    const cleanShades = shades.filter((sh) => sh.name.trim());
    const cleanSpecs = specRows.filter((r) => r.k.trim() && r.v.trim());
    const body: ProductInput = {
      sku: sku.trim(),
      name: name.trim(),
      brand: brand.trim() || undefined,
      description: description.trim() || undefined,
      categoryId,
      subCategory: subCategory.trim() || undefined,
      status,
      smartEpp,
      mrp: mrp ? Number(mrp) : undefined,
      mop: mop ? Number(mop) : undefined,
      cashbackType,
      cashbackValue: cashbackType !== 'NONE' && cashbackValue ? Number(cashbackValue) : undefined,
      hsnCode: hsnCode.trim() || undefined,
      gstPercent: gstPercent ? Number(gstPercent) : undefined,
      warrantyText: warrantyText.trim() || undefined,
      termsText: termsText.trim() || undefined,
      familyKey: familyKey.trim() || null,
      optionColor: optionColor.trim() || null,
      optionVariant: optionVariant.trim() || null,
      variantOptions: variantList.length ? variantList.join(', ') : undefined,
      freebieText: freebieText.trim() || undefined,
      shades: cleanShades,
      specRows: cleanSpecs,
      images: images.map((im, i) => ({ url: im.url, position: i })),
      g1: cleanShades[0]?.g1,
      g2: cleanShades[0]?.g2,
    };
    setBusy(true);
    try {
      const saved = product ? await updateProduct(product.id, body) : await createProduct(body);
      flash(product ? 'Product updated' : 'Product created — now add sellers');
      onSaved(saved.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save product');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.grid}>
        <div className={styles.main}>
          <Card pad="lg">
            <div className={s.sectionTitle}>Product details</div>
            <div className={styles.stack}>
              <Field label="Product name">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <div className={styles.pair}>
                <Field label="SKU">
                  <Input value={sku} onChange={(e) => setSku(e.target.value)} />
                </Field>
                <Field label="Brand">
                  <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
                </Field>
              </div>
              <div className={styles.pair}>
                <Field label="Category">
                  <select
                    className={styles.select}
                    value={categoryId}
                    onChange={(e) => {
                      setCategoryId(e.target.value);
                      setSubCategory('');
                    }}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sub-category" hint="e.g. flagship / audio / backpacks">
                  {subOptions.length > 0 ? (
                    <select className={styles.select} value={subCategory} onChange={(e) => setSubCategory(e.target.value)}>
                      <option value="">No sub-category</option>
                      {subOptions.map((sub) => (
                        <option key={sub.id} value={sub.name}>
                          {sub.name}
                        </option>
                      ))}
                      {subCategory && !subOptions.some((sub) => sub.name === subCategory) && (
                        <option value={subCategory}>{subCategory}</option>
                      )}
                    </select>
                  ) : (
                    <Input value={subCategory} onChange={(e) => setSubCategory(e.target.value)} />
                  )}
                </Field>
              </div>
              <Field label="Description">
                <textarea
                  className={styles.textarea}
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Shown to customers on the product page."
                />
              </Field>
            </div>
          </Card>

          <Card pad="lg">
            <div className={s.sectionTitle}>Images</div>
            <div className={styles.imageGrid}>
              {images.map((im, i) => (
                <div key={im.url} className={styles.uploaded}>
                  {i === 0 && <span className={styles.imgTag}>Primary</span>}
                  <img src={im.url} alt="" />
                  <button
                    className={styles.imgRemove}
                    onClick={() => setImages((xs) => xs.filter((_, j) => j !== i))}
                    aria-label="Remove image"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {Array.from({ length: uploading }).map((_, i) => (
                <div key={`u${i}`} className={styles.imgUploading}>
                  <span>Uploading…</span>
                </div>
              ))}
              <button className={styles.imgAdd} onClick={() => fileRef.current?.click()}>
                <ImagePlus size={20} />
                <span>Add image</span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
            </div>
          </Card>

          <Card pad="lg">
            <div className={s.sectionTitle}>Colours</div>
            <div className={styles.rowList}>
              {shades.map((sh, i) => (
                <div key={i} className={styles.shadeRow}>
                  <input
                    type="color"
                    className={styles.hex}
                    value={sh.g1}
                    onChange={(e) => setShade(i, { g1: e.target.value, g2: darken(e.target.value) })}
                    aria-label="Colour"
                  />
                  <Input placeholder="Colour name" value={sh.name} onChange={(e) => setShade(i, { name: e.target.value })} />
                  <button className={styles.removeBtn} onClick={() => removeShade(i)} aria-label="Remove colour">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <Button className={styles.addRowBtn} variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addShade}>
              Add colour
            </Button>
          </Card>

          <Card pad="lg">
            <div className={s.sectionTitle}>Specifications</div>
            <div className={styles.rowList}>
              {specRows.map((r, i) => (
                <div key={i} className={styles.specRow}>
                  <Input placeholder="Label (e.g. Display)" value={r.k} onChange={(e) => setSpec(i, { k: e.target.value })} />
                  <Input placeholder='Value (e.g. 6.7" OLED)' value={r.v} onChange={(e) => setSpec(i, { v: e.target.value })} />
                  <button className={styles.removeBtn} onClick={() => removeSpec(i)} aria-label="Remove spec">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <Button className={styles.addRowBtn} variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addSpec}>
              Add spec
            </Button>
          </Card>
        </div>

        <aside className={styles.rail}>
          <Card pad="lg">
            <div className={s.sectionTitle}>Status</div>
            <Segmented
              options={[
                { value: 'active', label: 'Active' },
                { value: 'draft', label: 'Draft' },
                { value: 'inactive', label: 'Inactive' },
              ]}
              value={status}
              onChange={setStatus}
            />
          </Card>
          <Card pad="lg">
            <div className={s.sectionTitle}>Smart EPP</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>
                Product comes under Smart EPP (SEPP)
              </span>
              <Toggle on={smartEpp} onClick={() => setSmartEpp((v) => !v)} />
            </div>
          </Card>
          <Card pad="lg">
            <div className={s.sectionTitle}>Pricing &amp; extras</div>
            <div className={styles.stack}>
              <Field label="MRP" hint="List price (struck-through for customers). Selling prices are set per seller.">
                <Input value={mrp} onChange={(e) => setMrp(e.target.value)} prefix="₹" inputMode="numeric" />
              </Field>
              <Field label="MOP price" hint="Public price shown before login (defaults to MRP if blank)">
                <Input value={mop} onChange={(e) => setMop(e.target.value)} prefix="₹" inputMode="numeric" />
              </Field>
              <Field label="Cashback" hint="Rewarded to the shopper's wallet when their order is delivered.">
                <select
                  className={styles.select}
                  value={cashbackType}
                  onChange={(e) => setCashbackType(e.target.value as 'NONE' | 'PERCENT' | 'FIXED')}
                >
                  <option value="NONE">No cashback</option>
                  <option value="PERCENT">Percent of price</option>
                  <option value="FIXED">Fixed ₹ per unit</option>
                </select>
              </Field>
              {cashbackType !== 'NONE' && (
                <Field label={cashbackType === 'PERCENT' ? 'Cashback percent' : 'Cashback amount (per unit)'}>
                  <Input
                    value={cashbackValue}
                    onChange={(e) => setCashbackValue(e.target.value)}
                    prefix={cashbackType === 'PERCENT' ? '%' : '₹'}
                    inputMode="numeric"
                  />
                </Field>
              )}
              <Field label="Variants" hint="Comma-separated, e.g. 128GB, 256GB">
                <Input value={variants} onChange={(e) => setVariants(e.target.value)} placeholder="128GB, 256GB" />
              </Field>
              {variantList.length > 0 && (
                <div className={styles.chips}>
                  {variantList.map((v) => (
                    <Chip key={v} label={v} variant="tint" />
                  ))}
                </div>
              )}
              <Field label="Freebie text" hint="First-party freebie badge (sellers can attach their own gift)">
                <Input value={freebieText} onChange={(e) => setFreebieText(e.target.value)} placeholder="Free case + glass" />
              </Field>
            </div>
          </Card>
          <Card pad="lg">
            <div className={s.sectionTitle}>Tax &amp; policies</div>
            <div className={styles.stack}>
              <div className={styles.pair}>
                <Field label="HSN code" hint="HSN / SAC code (for GST)">
                  <Input value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} placeholder="8517" />
                </Field>
                <Field label="GST %" hint="Tax rate">
                  <Input value={gstPercent} onChange={(e) => setGstPercent(e.target.value)} prefix="%" inputMode="numeric" placeholder="18" />
                </Field>
              </div>
              <Field label="Warranty" hint="Shown as the Warranty section on the product page">
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={warrantyText}
                  onChange={(e) => setWarrantyText(e.target.value)}
                  placeholder="1 year manufacturer warranty…"
                />
              </Field>
              <Field label="Terms &amp; Conditions" hint="Shown as the T&C section on the product page">
                <textarea
                  className={styles.textarea}
                  rows={4}
                  value={termsText}
                  onChange={(e) => setTermsText(e.target.value)}
                  placeholder="Return &amp; replacement terms, eligibility…"
                />
              </Field>
            </div>
          </Card>
          <Card pad="lg">
            <div className={s.sectionTitle}>Variant family</div>
            <div className={styles.stack}>
              <Field
                label="Family key"
                hint="Sibling SKUs sharing this key show as one card with colour/storage selectors. Leave blank for a standalone product."
              >
                <Input
                  value={familyKey}
                  onChange={(e) => setFamilyKey(e.target.value)}
                  placeholder="e.g. realme-c100x"
                  list="family-keys"
                />
                <datalist id="family-keys">
                  {families.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </Field>
              <div className={styles.pair}>
                <Field label="This SKU's colour" hint="e.g. Gold">
                  <Input value={optionColor} onChange={(e) => setOptionColor(e.target.value)} />
                </Field>
                <Field label="This SKU's variant" hint="e.g. 64GB">
                  <Input value={optionVariant} onChange={(e) => setOptionVariant(e.target.value)} />
                </Field>
              </div>
            </div>
          </Card>
          {!product && (
            <Card pad="lg">
              <p className={styles.note}>
                After saving, you'll manage <strong>sellers &amp; prices</strong> (which resellers list this product, and
                their stock) on the product page.
              </p>
            </Card>
          )}
        </aside>
      </div>

      <div className={styles.saveBar}>
        <div className={styles.saveMsg}>
          <span className={styles.saveDot} />
          {product ? 'Editing product master' : 'New product'}
        </div>
        <div className={styles.saveActions}>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" icon={<Save size={14} />} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : product ? 'Save product' : 'Save & add sellers'}
          </Button>
        </div>
      </div>
    </div>
  );
}
