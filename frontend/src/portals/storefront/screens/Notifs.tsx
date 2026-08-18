import { useEffect, useState } from 'react';
import { Truck, CreditCard, TrendingDown, Package, BellOff } from 'lucide-react';
import { EmptyState } from '@/components';
import type { NotifType } from '@/data/store-types';
import { useStore } from '../store-context';
import { cn } from '@/lib/cn';
import styles from './Notifs.module.css';

const ICONS: Record<NotifType, typeof Truck> = {
  delivery: Truck,
  payment: CreditCard,
  pricedrop: TrendingDown,
  order: Package,
};
const COLORS: Record<NotifType, string> = {
  delivery: 'var(--info)',
  payment: 'var(--success)',
  pricedrop: 'var(--accent)',
  order: 'var(--text2)',
};

// "2h ago" style relative time for an ISO timestamp.
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function Notifs() {
  const { notifs, notifsUnread, markNotifsSeen } = useStore();

  // The unread cutoff as it was when this screen opened (captured once) — so
  // the visit that clears the dot still highlights what was new.
  const [seenAt] = useState(() => {
    try {
      return localStorage.getItem('imc_shopper_notifs_seen') ?? '';
    } catch {
      return '';
    }
  });

  // Opening the screen marks everything as seen (clears the red dot).
  useEffect(() => {
    if (notifsUnread) markNotifsSeen();
  }, [notifsUnread, markNotifsSeen]);

  return (
    <div>
      <div className={styles.title}>Alerts</div>
      {notifs.length === 0 ? (
        <EmptyState
          icon={<BellOff size={24} />}
          title="No alerts yet"
          body="Order updates — placed, dispatched, delivered — will show up here."
        />
      ) : (
        <div className={styles.list}>
          {notifs.map((n) => {
            const Icon = ICONS[n.type] ?? Package;
            const unread = !seenAt || n.at > seenAt;
            return (
              <div key={n.id} className={cn(styles.notif, unread && styles.unread)}>
                <span
                  className={styles.icon}
                  style={{ color: COLORS[n.type], background: `color-mix(in srgb, ${COLORS[n.type]} 12%, var(--surface))` }}
                >
                  <Icon size={17} />
                </span>
                <div className={styles.body}>
                  <div className={styles.notifTitle}>{n.title}</div>
                  <div className={styles.notifBody}>{n.body}</div>
                </div>
                <span className={styles.time}>{timeAgo(n.at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
