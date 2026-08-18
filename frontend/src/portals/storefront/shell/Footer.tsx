import { NavLink, useNavigate } from 'react-router-dom';
import { Logo } from '@/components';
import type { StoreCategory } from '@/data/store-types';
import { useStore } from '../store-context';
import styles from './Footer.module.css';

const SHOP_LINKS: { label: string; category: StoreCategory }[] = [
  { label: 'All products', category: 'all' },
  { label: 'Phones', category: 'phones' },
  { label: 'Phone accessories', category: 'accessories' },
  { label: 'Bags', category: 'bags' },
];

export function Footer() {
  const navigate = useNavigate();
  const { setFilters } = useStore();

  const goCategory = (category: StoreCategory) => {
    setFilters({ category, sub: null, brands: [] });
    navigate('/shop/home');
  };

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <button className={styles.brand} onClick={() => navigate('/shop/home')}>
            <Logo size={26} />
            <span className={styles.word}>imcorpcart</span>
          </button>
          <p className={styles.tagline}>Corporate employee purchase program — negotiated rates on the tech your team loves.</p>
        </div>

        <div className={styles.col}>
          <div className={styles.colTitle}>Company</div>
          <NavLink to="/shop/about" className={styles.link}>About</NavLink>
          <NavLink to="/shop/contact" className={styles.link}>Contact</NavLink>
        </div>

        <div className={styles.col}>
          <div className={styles.colTitle}>Shop</div>
          {SHOP_LINKS.map((l) => (
            <button key={l.category} className={styles.linkBtn} onClick={() => goCategory(l.category)}>
              {l.label}
            </button>
          ))}
        </div>

        <div className={styles.col}>
          <div className={styles.colTitle}>Get in touch</div>
          <a href="mailto:sales@imcorpcart.com" className={styles.link}>sales@imcorpcart.com</a>
          <a href="tel:+919120391203" className={styles.link}>+91 91203 91203</a>
        </div>
      </div>

      <div className={styles.bottom}>
        <span>© {'imcorpcart'} · Corporate EPP commerce</span>
      </div>
    </footer>
  );
}
