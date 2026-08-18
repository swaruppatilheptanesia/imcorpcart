import { useRef, useState } from 'react';
import { Plus, Pencil, Trash2, AlertTriangle, GalleryHorizontalEnd, ImagePlus, Loader2 } from 'lucide-react';
import { Button, Card, StatusPill, Field, Input, Toggle, Modal, Skeleton, EmptyState, useToast } from '@/components';
import { useAsync } from '@/lib/useAsync';
import {
  getBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  uploadImage,
  type AdminBanner,
} from '@/data/api';
import { ApiError } from '@/data/http';
import s from './screen.module.css';
import styles from './Banners.module.css';

// Image upload rules — kept in sync with the backend multer config
// (backend/src/config/upload.ts): PNG/JPG/WEBP, 5MB.
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const SIZE_HINT = 'Recommended 1600 × 500 px (16:5) · JPG, PNG or WEBP · max 5 MB';

export function Banners() {
  const { flash } = useToast();
  const { data, state, error, reload } = useAsync(() => getBanners(), [], (d) => d.length === 0);
  const [editing, setEditing] = useState<AdminBanner | 'new' | null>(null);

  const banners = data ?? [];

  const toggleActive = async (b: AdminBanner) => {
    try {
      await updateBanner(b.id, { isActive: !b.isActive });
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Update failed');
    }
  };

  const onDelete = async (b: AdminBanner) => {
    if (!window.confirm(`Delete banner "${b.title}"?`)) return;
    try {
      await deleteBanner(b.id);
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not delete');
    }
  };

  return (
    <div>
      <div className={s.toolbar}>
        <div className={s.spacer} />
        <Button size="sm" icon={<Plus size={16} strokeWidth={2.2} />} onClick={() => setEditing('new')}>
          New banner
        </Button>
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} h={92} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load banners"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<GalleryHorizontalEnd size={24} />}
          title="No banners yet"
          body="Add a promotional banner — active banners appear as a carousel at the top of the shopper Home page."
          action={{ label: 'New banner', onClick: () => setEditing('new') }}
        />
      )}

      {state === 'live' && (
        <div className={styles.list}>
          {banners.map((b) => (
            <Card key={b.id} pad="md" className={styles.row}>
              <img className={styles.thumb} src={b.imageUrl} alt={b.title} />
              <div className={styles.info}>
                <div className={styles.titleRow}>
                  <span className={styles.name}>{b.title}</span>
                  <StatusPill label={b.isActive ? 'Active' : 'Inactive'} tone={b.isActive ? 'success' : 'neutral'} />
                  <span className={styles.order}>Order {b.sortOrder}</span>
                </div>
                <span className={styles.link}>{b.linkUrl || 'No link (decorative)'}</span>
              </div>
              <div className={styles.actions}>
                <button className={s.iconBtn} aria-label="Edit banner" onClick={() => setEditing(b)}>
                  <Pencil size={16} />
                </button>
                <Button size="sm" variant="secondary" onClick={() => toggleActive(b)}>
                  {b.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <button className={s.iconBtn} aria-label="Delete banner" onClick={() => onDelete(b)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <BannerModal
          banner={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function BannerModal({
  banner,
  onClose,
  onSaved,
}: {
  banner: AdminBanner | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { flash } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(banner?.title ?? '');
  const [imageUrl, setImageUrl] = useState(banner?.imageUrl ?? '');
  const [linkUrl, setLinkUrl] = useState(banner?.linkUrl ?? '');
  const [sortOrder, setSortOrder] = useState(String(banner?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(banner?.isActive ?? true);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      flash('Only PNG, JPG, or WEBP images are allowed');
      return;
    }
    if (file.size > MAX_BYTES) {
      flash('Image must be 5 MB or smaller');
      return;
    }
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setImageUrl(url);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Image upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const valid = title.trim() && imageUrl;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body = {
        title: title.trim(),
        imageUrl,
        linkUrl: linkUrl.trim() || undefined,
        sortOrder: Number(sortOrder) || 0,
        isActive,
      };
      if (banner) await updateBanner(banner.id, body);
      else await createBanner(body);
      onSaved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save banner');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={banner ? 'Edit banner' : 'New banner'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={!valid || busy || uploading}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pre-book the new flagship" />
      </Field>

      <div className={styles.uploader}>
        <div className={styles.activeLabel} style={{ fontSize: 12, color: 'var(--text2)' }}>Banner image</div>
        <div className={styles.dropzone} onClick={() => fileRef.current?.click()}>
          {uploading ? (
            <span className={styles.placeholder}>
              <Loader2 size={22} style={{ animation: 'saSpin 0.7s linear infinite' }} /> Uploading…
            </span>
          ) : imageUrl ? (
            <img className={styles.preview} src={imageUrl} alt="Banner preview" />
          ) : (
            <span className={styles.placeholder}>
              <ImagePlus size={22} /> Click to upload
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
        <div className={styles.hint}>{SIZE_HINT}</div>
      </div>

      <Field label="Link URL (optional)">
        <Input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="/shop/product/<id>, a category, or https://…"
        />
      </Field>

      <div className={styles.grid2}>
        <Field label="Sort order">
          <Input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
        <div className={styles.activeRow}>
          <span className={styles.activeLabel}>Active</span>
          <Toggle on={isActive} onClick={() => setIsActive((v) => !v)} />
        </div>
      </div>
    </Modal>
  );
}
