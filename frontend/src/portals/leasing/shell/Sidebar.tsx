import { NavLink } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Avatar, Brand } from '@/components';
import { cn } from '@/lib/cn';
import { activeNav, navDefs } from '../nav';
import styles from '../../super-admin/shell/Sidebar.module.css';

export function Sidebar({
  route,
  companyName,
  operatorName,
  onSignOut,
}: {
  route: string;
  companyName: string;
  operatorName: string;
  onSignOut: () => void;
}) {
  const active = activeNav(route);
  const initials = operatorName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <Brand sub="LEASING PORTAL" />
      </div>

      <nav className={styles.nav}>
        {navDefs.map((n) => {
          const Icon = n.icon;
          const isActive = active === n.key;
          return (
            <NavLink
              key={n.key}
              to={`/leasing/${n.key}`}
              className={cn(styles.item, isActive && styles.itemActive)}
            >
              <Icon size={18} strokeWidth={1.9} />
              <span>{n.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <Avatar initials={initials || 'LC'} size={34} />
        <div className={styles.who}>
          <div className={styles.whoName}>{operatorName || 'Operator'}</div>
          <div className={styles.whoSub}>{companyName || 'Leasing company'}</div>
        </div>
        <button className={styles.signout} onClick={onSignOut} aria-label="Sign out">
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}
