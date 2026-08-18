import { NavLink } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Logo } from '@/components';
import { Avatar } from '@/components';
import { cn } from '@/lib/cn';
import { getStoredUser } from '@/data/auth-store';
import { initialsOf } from '@/data/map';
import { activeNav, navDefs } from '../nav';
import styles from './Sidebar.module.css';

export function Sidebar({ route, onSignOut }: { route: string; onSignOut: () => void }) {
  const active = activeNav(route);
  const adminName = getStoredUser()?.fullName ?? 'Super Admin';
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <Logo size={30} />
        <div>
          <div className={styles.word}>imcorpcart</div>
          <div className={styles.role}>SUPER ADMIN</div>
        </div>
      </div>

      <nav className={styles.nav}>
        {navDefs.map((n) => {
          const Icon = n.icon;
          const isActive = active === n.key;
          return (
            <NavLink
              key={n.key}
              to={`/super-admin/${n.key}`}
              className={cn(styles.item, isActive && styles.itemActive)}
            >
              <Icon size={18} strokeWidth={1.9} />
              <span>{n.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <Avatar initials={initialsOf(adminName)} size={34} />
        <div className={styles.who}>
          <div className={styles.whoName}>{adminName}</div>
          <div className={styles.whoSub}>Portal admin</div>
        </div>
        <button className={styles.signout} onClick={onSignOut} aria-label="Sign out">
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}
