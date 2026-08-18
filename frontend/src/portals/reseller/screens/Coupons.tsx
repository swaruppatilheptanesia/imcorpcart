import { useState } from 'react';
import { Search, Pencil, TicketPercent, AlertTriangle, Gift, Plus } from 'lucide-react';
import {
  Segmented,
  Input,
  Card,
  Button,
  DataTable,
  Row,
  StatusPill,
  ProgressBar,
  EmptyState,
  Skeleton,
} from '@/components';
import type { SemanticTone } from '@/data/types';
import type { ResellerCoupon } from '@/data/store-types';
import { useAsync } from '@/lib/useAsync';
import { inr, group } from '@/lib/format';
import { useRS } from '../context';
import { getResellerCoupons, getResellerFreeGifts, type ResellerFreeGift } from '../data';
import { FreeGiftModal } from '../overlays/FreeGiftModal';
import s from './screen.module.css';
import styles from './Coupons.module.css';

const COLS = '1.5fr 1.3fr 1.1fr 1.4fr 1fr 40px';

const statusTone: Record<ResellerCoupon['status'], SemanticTone> = {
  active: 'success',
  scheduled: 'warning',
  expired: 'neutral',
};

function valueLabel(c: ResellerCoupon) {
  return c.type === 'pct' ? `${c.val}% off` : `${inr(c.val)} off`;
}
function capLabel(c: ResellerCoupon) {
  const parts: string[] = [];
  if (c.type === 'pct' && c.cap) parts.push(`up to ${inr(c.cap)}`);
  if (c.min) parts.push(`min ${inr(c.min)}`);
  return parts.length ? parts.join(' · ') : 'No minimum';
}

export function Coupons() {
  const { openCoupon } = useRS();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | ResellerCoupon['status']>('all');
  const { data, state, error, reload } = useAsync(() => getResellerCoupons(), []);

  const all = data ?? [];
  const rows = all.filter((c) => {
    if (status !== 'all' && c.status !== status) return false;
    if (q && !`${c.code} ${c.scope}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const stats = [
    { label: 'Active coupons', value: String(all.filter((c) => c.status === 'active').length) },
    { label: 'Total redemptions', value: group(all.reduce((n, c) => n + c.used, 0)) },
    { label: 'Scheduled', value: String(all.filter((c) => c.status === 'scheduled').length) },
  ];

  return (
    <div>
      <div className={styles.stats}>
        {stats.map((st) => (
          <Card key={st.label} pad="sm" className={styles.stat}>
            <div className={styles.statLabel}>{st.label}</div>
            <div className={styles.statValue}>{st.value}</div>
          </Card>
        ))}
      </div>

      <div className={s.toolbar}>
        <div className={s.search}>
          <Search size={16} className={s.searchIcon} />
          <Input
            className={s.searchInput}
            placeholder="Search coupon code…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className={s.spacer} />
        <Segmented
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'expired', label: 'Expired' },
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>

      {state === 'loading' && (
        <div className={styles.skeletons}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      )}
      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load coupons"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}
      {state !== 'loading' && state !== 'error' && rows.length === 0 && (
        <EmptyState
          icon={<TicketPercent size={24} />}
          title="No coupons here"
          body="No coupons match this filter. Create one to get started."
          action={{ label: 'New coupon', onClick: openCoupon }}
        />
      )}
      {state !== 'loading' && state !== 'error' && rows.length > 0 && (
        <DataTable cols={COLS} headers={['Code', 'Discount', 'Applies to', 'Usage', 'Status', '']}>
          {rows.map((c) => (
            <Row key={c.code} cols={COLS}>
              <div>
                <span className={styles.code}>{c.code}</span>
                <div className={styles.ends}>
                  {c.status === 'scheduled' ? 'Starts ' : 'Ends '}
                  {c.ends}
                </div>
              </div>
              <div>
                <div className={styles.value}>{valueLabel(c)}</div>
                <div className={styles.cap}>{capLabel(c)}</div>
              </div>
              <div className={s.muted}>{c.scope}</div>
              <div className={styles.usage}>
                <div className={styles.usageText}>
                  {group(c.used)} / {group(c.limit)}
                </div>
                <ProgressBar pct={(c.used / c.limit) * 100} />
              </div>
              <div>
                <StatusPill label={c.status[0].toUpperCase() + c.status.slice(1)} tone={statusTone[c.status]} />
              </div>
              <button className={s.iconBtn} aria-label="Edit coupon" onClick={openCoupon}>
                <Pencil size={16} />
              </button>
            </Row>
          ))}
        </DataTable>
      )}

      <FreeGiftsSection />
    </div>
  );
}

function FreeGiftsSection() {
  const { data, state, reload } = useAsync(() => getResellerFreeGifts(), []);
  const [editing, setEditing] = useState<{ gift: ResellerFreeGift | null } | null>(null);
  const gifts = data ?? [];

  return (
    <section className={styles.giftsSection}>
      <div className={styles.giftsHead}>
        <div>
          <div className={styles.giftsTitle}><Gift size={16} /> Free gifts</div>
          <div className={styles.giftsSub}>Complimentary items you can attach to your products.</div>
        </div>
        <Button size="sm" icon={<Plus size={15} />} onClick={() => setEditing({ gift: null })}>
          New free gift
        </Button>
      </div>

      {state === 'loading' && <Skeleton h={64} />}

      {state !== 'loading' && gifts.length === 0 && (
        <div className={styles.giftsEmpty}>No free gifts yet. Create one to attach it to your products.</div>
      )}

      {gifts.length > 0 && (
        <div className={styles.giftList}>
          {gifts.map((g) => (
            <div key={g.id} className={styles.giftRow}>
              <div className={styles.giftIcon}><Gift size={16} /></div>
              <div className={styles.giftBody}>
                <div className={styles.giftName}>{g.title}</div>
                {g.description && <div className={styles.giftDesc}>{g.description}</div>}
              </div>
              <StatusPill label={g.isActive ? 'Active' : 'Inactive'} tone={g.isActive ? 'success' : 'neutral'} />
              <button className={s.iconBtn} aria-label="Edit gift" onClick={() => setEditing({ gift: g })}>
                <Pencil size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <FreeGiftModal
          gift={editing.gift}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}
