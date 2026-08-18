import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, AlertTriangle, Check, X, Eye, ExternalLink } from 'lucide-react';
import { Chip, DataTable, Row, StatusPill, EmptyState, Skeleton, Button, Modal, useToast } from '@/components';
import type { SemanticTone } from '@/data/types';
import { getReviews, setReviewStatus, type ReviewRow, type ReviewStatus } from '@/data/api';
import { useAsync } from '@/lib/useAsync';
import s from './screen.module.css';
import styles from './Reviews.module.css';

const COLS = 'minmax(0, 1.4fr) minmax(0, 1fr) 64px minmax(0, 2fr) 96px 108px 240px';

type Filter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'all';

const STATUS_TONE: Record<ReviewStatus, SemanticTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
};

export function Reviews() {
  const navigate = useNavigate();
  const { flash } = useToast();
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReviewRow | null>(null);

  const { data, state, error, reload } = useAsync(
    () => getReviews(filter === 'all' ? undefined : filter, { page: 1 }),
    [filter],
    (d) => d.items.length === 0,
  );
  const rows = data?.items ?? [];

  const act = async (r: ReviewRow, status: 'APPROVED' | 'REJECTED') => {
    setBusyId(r.id);
    try {
      await setReviewStatus(r.id, status);
      flash(status === 'APPROVED' ? 'Review approved & published' : 'Review rejected');
      setSelected(null);
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not update the review');
    } finally {
      setBusyId(null);
    }
  };

  const viewProduct = (r: ReviewRow) => navigate(`/super-admin/productDetail/${r.productId}`);

  const filters: { value: Filter; label: string }[] = [
    { value: 'PENDING', label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: 'all', label: 'All' },
  ];

  return (
    <div>
      <div className={styles.filters}>
        {filters.map((f) => (
          <Chip key={f.value} label={f.label} active={filter === f.value} onClick={() => setFilter(f.value)} />
        ))}
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} h={56} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load reviews"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState icon={<Star size={24} />} title="No reviews" body="No reviews match this filter." />
      )}

      {state === 'live' && (
        <DataTable
          cols={COLS}
          headers={['Product', 'Author', 'Rating', 'Review', 'Submitted', 'Status', '']}
        >
          {rows.map((r) => (
            <Row key={r.id} cols={COLS}>
              <button className={styles.productBtn} onClick={() => setSelected(r)} title="View full review">
                <span className={s.cellName}>{r.productName}</span>
                <span className={s.cellSub}> {r.productSku}</span>
              </button>
              <div className={s.muted}>
                {r.author}
                <div className={styles.email}>{r.authorEmail}</div>
              </div>
              <div className={styles.rating}>
                {r.rating}
                <Star size={13} fill="var(--warning)" color="var(--warning)" />
              </div>
              <button className={styles.bodyBtn} onClick={() => setSelected(r)} title="View full review">
                {r.title && <strong className={styles.bodyTitle}>{r.title} — </strong>}
                {r.body}
              </button>
              <div className={styles.date}>{new Date(r.createdAt).toLocaleDateString('en-IN')}</div>
              <div>
                <StatusPill label={r.status} tone={STATUS_TONE[r.status]} />
              </div>
              <div className={styles.actions}>
                <button className={s.iconBtn} onClick={() => setSelected(r)} aria-label="View review" title="View">
                  <Eye size={16} />
                </button>
                {r.status !== 'APPROVED' && (
                  <Button
                    size="sm"
                    icon={<Check size={14} />}
                    disabled={busyId === r.id}
                    onClick={() => act(r, 'APPROVED')}
                  >
                    Approve
                  </Button>
                )}
                {r.status !== 'REJECTED' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<X size={14} />}
                    disabled={busyId === r.id}
                    onClick={() => act(r, 'REJECTED')}
                  >
                    Reject
                  </Button>
                )}
              </div>
            </Row>
          ))}
        </DataTable>
      )}

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Review"
        width={560}
        footer={
          selected && (
            <div className={styles.modalFooter}>
              <Button variant="ghost" icon={<ExternalLink size={15} />} onClick={() => viewProduct(selected)}>
                View full product
              </Button>
              <div className={styles.modalActions}>
                {selected.status !== 'REJECTED' && (
                  <Button
                    variant="secondary"
                    icon={<X size={15} />}
                    disabled={busyId === selected.id}
                    onClick={() => act(selected, 'REJECTED')}
                  >
                    Reject
                  </Button>
                )}
                {selected.status !== 'APPROVED' && (
                  <Button
                    icon={<Check size={15} />}
                    disabled={busyId === selected.id}
                    onClick={() => act(selected, 'APPROVED')}
                  >
                    Approve
                  </Button>
                )}
              </div>
            </div>
          )
        }
      >
        {selected && (
          <div className={styles.detail}>
            <div className={styles.detailProduct}>
              <button className={styles.detailProductLink} onClick={() => viewProduct(selected)}>
                {selected.productName} <ExternalLink size={13} />
              </button>
              <span className={s.cellSub}>{selected.productSku}</span>
            </div>
            <div className={styles.detailMeta}>
              <span className={styles.detailStars}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    size={16}
                    fill={i < selected.rating ? 'var(--warning)' : 'none'}
                    color="var(--warning)"
                  />
                ))}
              </span>
              <StatusPill label={selected.status} tone={STATUS_TONE[selected.status]} />
            </div>
            {selected.title && <div className={styles.detailTitle}>{selected.title}</div>}
            <p className={styles.detailBody}>{selected.body}</p>
            <div className={styles.detailFoot}>
              By <strong>{selected.author}</strong> · {selected.authorEmail} ·{' '}
              {new Date(selected.createdAt).toLocaleDateString('en-IN')}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
