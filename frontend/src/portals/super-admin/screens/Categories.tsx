import { useState } from 'react';
import { Plus, Pencil, Trash2, AlertTriangle, FolderTree, Search } from 'lucide-react';
import { Button, Card, StatusPill, Segmented, Field, Input, Toggle, Modal, Skeleton, EmptyState, useToast } from '@/components';
import { useAsync } from '@/lib/useAsync';
import { getCategories, createCategory, updateCategory, deleteCategory } from '@/data/api';
import { ApiError } from '@/data/http';
import s from './screen.module.css';
import styles from './Categories.module.css';

type EditTarget =
  | { mode: 'newCategory' }
  | { mode: 'newSub'; parentId: string; parentName: string }
  | { mode: 'edit'; id: string; name: string; isActive: boolean };

export function Categories() {
  const { flash } = useToast();
  const { data, state, error, reload } = useAsync(() => getCategories(), [], (d) => d.length === 0);
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');

  const cats = data ?? [];

  // Client-side filter: getCategories() returns the full tree, so search + status
  // are applied in-memory. A card matches if the parent name/slug OR any child's
  // name/slug contains the query, and the parent's active state matches the filter.
  const query = q.trim().toLowerCase();
  const filtered = cats.filter((c) => {
    if (status !== 'all' && c.isActive !== (status === 'active')) return false;
    if (!query) return true;
    const hay = `${c.name} ${c.slug} ${c.children.map((sub) => `${sub.name} ${sub.slug}`).join(' ')}`.toLowerCase();
    return hay.includes(query);
  });

  const onDeactivate = async (id: string, isActive: boolean) => {
    try {
      await updateCategory(id, { isActive: !isActive });
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Update failed');
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm('Delete this category? Only unused categories can be deleted.')) return;
    try {
      await deleteCategory(id);
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not delete');
    }
  };

  return (
    <div>
      <div className={s.toolbar}>
        <div className={s.search}>
          <Search size={16} className={s.searchIcon} />
          <Input
            className={s.searchInput}
            placeholder="Search categories"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Segmented
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
          value={status}
          onChange={(v) => setStatus(v as 'all' | 'active' | 'inactive')}
        />
        <div className={s.spacer} />
        <Button size="sm" icon={<Plus size={16} strokeWidth={2.2} />} onClick={() => setTarget({ mode: 'newCategory' })}>
          New category
        </Button>
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} h={96} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load categories"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<FolderTree size={24} />}
          title="No categories yet"
          body="Create your first category to organize the catalog."
          action={{ label: 'New category', onClick: () => setTarget({ mode: 'newCategory' }) }}
        />
      )}

      {state === 'live' && filtered.length === 0 && (
        <EmptyState
          icon={<FolderTree size={24} />}
          title="No matching categories"
          body="Try a different search or filter."
          action={{ label: 'Clear filters', onClick: () => { setQ(''); setStatus('all'); } }}
        />
      )}

      {state === 'live' && filtered.length > 0 && (
        <div className={styles.list}>
          {filtered.map((c) => (
            <Card key={c.id} pad="lg" className={styles.catCard}>
              <div className={styles.catHead}>
                <div className={styles.catTitle}>
                  <span className={styles.catName}>{c.name}</span>
                  <StatusPill label={c.isActive ? 'Active' : 'Inactive'} tone={c.isActive ? 'success' : 'neutral'} />
                  <span className={styles.catCount}>{c._count?.products ?? 0} products</span>
                </div>
                <div className={styles.catActions}>
                  <button className={s.iconBtn} aria-label="Edit category" onClick={() => setTarget({ mode: 'edit', id: c.id, name: c.name, isActive: c.isActive })}>
                    <Pencil size={16} />
                  </button>
                  <button className={s.iconBtn} aria-label="Toggle active" onClick={() => onDeactivate(c.id, c.isActive)}>
                    <span className={styles.toggleText}>{c.isActive ? 'Deactivate' : 'Activate'}</span>
                  </button>
                  <button className={s.iconBtn} aria-label="Delete category" onClick={() => onDelete(c.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className={styles.subs}>
                {c.children.map((sub) => (
                  <div key={sub.id} className={styles.subRow}>
                    <span className={styles.subName}>{sub.name}</span>
                    {!sub.isActive && <StatusPill label="Inactive" tone="neutral" />}
                    <span className={styles.subCount}>{sub._count?.products ?? 0}</span>
                    <button className={s.iconBtn} aria-label="Edit subcategory" onClick={() => setTarget({ mode: 'edit', id: sub.id, name: sub.name, isActive: sub.isActive })}>
                      <Pencil size={14} />
                    </button>
                    <button className={s.iconBtn} aria-label="Toggle subcategory" onClick={() => onDeactivate(sub.id, sub.isActive)}>
                      <span className={styles.toggleText}>{sub.isActive ? 'Deactivate' : 'Activate'}</span>
                    </button>
                    <button className={s.iconBtn} aria-label="Delete subcategory" onClick={() => onDelete(sub.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button className={styles.addSub} onClick={() => setTarget({ mode: 'newSub', parentId: c.id, parentName: c.name })}>
                  <Plus size={14} /> Add subcategory
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {target && (
        <CategoryModal
          target={target}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function CategoryModal({
  target,
  onClose,
  onSaved,
}: {
  target: EditTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { flash } = useToast();
  const [name, setName] = useState(target.mode === 'edit' ? target.name : '');
  const [isActive, setIsActive] = useState(target.mode === 'edit' ? target.isActive : true);
  const [busy, setBusy] = useState(false);

  const title =
    target.mode === 'edit'
      ? 'Edit category'
      : target.mode === 'newSub'
        ? `New subcategory · ${target.parentName}`
        : 'New category';

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (target.mode === 'edit') await updateCategory(target.id, { name: name.trim(), isActive });
      else if (target.mode === 'newSub') await createCategory({ name: name.trim(), parentId: target.parentId, isActive });
      else await createCategory({ name: name.trim(), isActive });
      onSaved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save category');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={!name.trim() || busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Phones" />
      </Field>
      <div className={styles.activeRow}>
        <span className={styles.activeLabel}>Active</span>
        <Toggle on={isActive} onClick={() => setIsActive((v) => !v)} />
      </div>
    </Modal>
  );
}
