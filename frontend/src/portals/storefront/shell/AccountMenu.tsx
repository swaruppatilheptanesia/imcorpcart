import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Package, Heart, Bell, User, LogOut } from 'lucide-react';
import { Avatar } from '@/components';
import { getProfile, shopStore, type ShopProfileApi } from '@/data/shop-api';
import { initialsOf } from '@/data/map';
import { useStore } from '../store-context';
import styles from './AccountMenu.module.css';

export function AccountMenu({ onClose, onSignOut }: { onClose: () => void; onSignOut: () => void }) {
  const navigate = useNavigate();
  const { wishlist, notifsUnread } = useStore();
  const ref = useRef<HTMLDivElement | null>(null);

  // The signed-in user: stored auth user renders instantly; the live profile
  // fills in company + program when it arrives.
  const stored = shopStore.getStoredUser();
  const [profile, setProfile] = useState<ShopProfileApi | null>(null);
  useEffect(() => {
    let cancelled = false;
    getProfile()
      .then((p) => !cancelled && setProfile(p))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const name = profile?.name ?? stored?.fullName ?? '—';
  const sub = profile ? `${profile.company} · ${profile.program}` : (stored?.email ?? '');

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // defer so the opening click doesn't immediately close it
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [onClose]);

  const go = (path: string) => {
    navigate(`/shop/${path}`);
    onClose();
  };

  const rows = [
    { icon: Store, label: 'Store', path: 'home' },
    { icon: Package, label: 'Orders', path: 'orders' },
    { icon: Heart, label: 'Wishlist', path: 'wishlist', badge: wishlist.length || undefined },
    { icon: Bell, label: 'Alerts', path: 'notifs', dot: notifsUnread },
    { icon: User, label: 'Profile', path: 'profile' },
  ];

  return (
    <div ref={ref} className={styles.menu}>
      <div className={styles.header}>
        <Avatar initials={initialsOf(name)} size={38} />
        <div>
          <div className={styles.name}>{name}</div>
          <div className={styles.sub}>{sub}</div>
        </div>
      </div>
      <div className={styles.rows}>
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <button key={r.label} className={styles.row} onClick={() => go(r.path)}>
              <Icon size={17} />
              <span>{r.label}</span>
              {r.badge ? <span className={styles.badge}>{r.badge}</span> : null}
              {r.dot ? <span className={styles.redDot} /> : null}
            </button>
          );
        })}
      </div>
      <div className={styles.divider} />
      <button className={styles.signout} onClick={onSignOut}>
        <LogOut size={17} />
        <span>Sign out</span>
      </button>
    </div>
  );
}
