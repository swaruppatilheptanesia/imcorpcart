import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useStore } from '../store-context';
import { tabs } from '../nav';
import styles from './TabBar.module.css';

export function TabBar({ route }: { route: string }) {
  const navigate = useNavigate();
  const { cartCount } = useStore();

  return (
    <nav className={styles.bar}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = route === t.key;
        return (
          <button
            key={t.key}
            className={cn(styles.tab, active && styles.active)}
            onClick={() => navigate(`/shop/${t.key}`)}
          >
            <span className={styles.iconWrap}>
              <Icon size={21} strokeWidth={active ? 2.2 : 1.9} />
              {t.key === 'cart' && cartCount > 0 && <span className={styles.badge}>{cartCount}</span>}
            </span>
            <span className={styles.label}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
