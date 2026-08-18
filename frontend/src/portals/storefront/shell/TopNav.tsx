import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ShoppingCart, MoreVertical } from 'lucide-react';
import { Logo } from '@/components';
import { useStore } from '../store-context';
import { AccountMenu } from './AccountMenu';
import styles from './TopNav.module.css';

export function TopNav({
  authed,
  onSignOut,
  onSignIn,
}: {
  authed: boolean;
  onSignOut: () => void;
  onSignIn: () => void;
}) {
  const navigate = useNavigate();
  const { cartCount, search, setSearch } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={styles.nav}>
      <button className={styles.brand} onClick={() => navigate('/shop/home')}>
        <Logo size={30} />
        <span className={styles.word}>imcorpcart</span>
      </button>

      <div className={styles.search}>
        <Search size={16} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          placeholder="Search phones, brands…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/shop/search')}
        />
      </div>

      <div className={styles.spacer} />

      {authed ? (
        <>
          <button className={styles.iconBtn} onClick={() => navigate('/shop/cart')} aria-label="Cart">
            <ShoppingCart size={20} />
            {cartCount > 0 && <span className={styles.cartBadge}>{cartCount}</span>}
          </button>

          <div className={styles.menuWrap}>
            <button className={styles.roundBtn} onClick={() => setMenuOpen((o) => !o)} aria-label="Account">
              <MoreVertical size={18} />
            </button>
            {menuOpen && <AccountMenu onClose={() => setMenuOpen(false)} onSignOut={onSignOut} />}
          </div>
        </>
      ) : (
        <button className={styles.signInBtn} onClick={onSignIn}>
          Sign in
        </button>
      )}
    </header>
  );
}
