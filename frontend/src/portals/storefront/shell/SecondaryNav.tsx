import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Menu } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StoreCategory } from '@/data/store-types';
import { useStore } from '../store-context';
import { categoryTree, featuredDepartments } from '../data';
import styles from './SecondaryNav.module.css';

// Sentinel openKey for the "All Categories" mega-menu (can't collide with a slug).
const ALL_KEY = '__all__';

export function SecondaryNav() {
  const navigate = useNavigate();
  const { setFilters } = useStore();
  const featured = featuredDepartments(); // curated inline departments
  const tree = categoryTree(); // full department list for the mega-menu
  // Which category's subcategory dropdown (or the mega-menu) is open (hover-driven).
  const [openKey, setOpenKey] = useState<string | null>(null);

  const pick = (category: StoreCategory, sub: string | null = null) => {
    setFilters({ category, sub, brands: [] });
    setOpenKey(null);
    navigate('/shop/home');
  };

  return (
    <nav className={styles.bar}>
      <button className={styles.allLink} onClick={() => pick('all')}>
        All products
      </button>

      {/* Amazon-style "All Categories" mega-menu — holds every department. */}
      <div
        className={styles.item}
        onMouseEnter={() => setOpenKey(ALL_KEY)}
        onMouseLeave={() => setOpenKey((k) => (k === ALL_KEY ? null : k))}
      >
        <button className={styles.megaBtn} onClick={() => setOpenKey((k) => (k === ALL_KEY ? null : ALL_KEY))}>
          <Menu size={15} />
          All Categories
          <ChevronDown size={13} className={cn(styles.chev, openKey === ALL_KEY && styles.chevOpen)} />
        </button>

        {openKey === ALL_KEY && (
          <div className={styles.megaPanel}>
            {tree.map((node) => (
              <div key={node.key} className={styles.megaCol}>
                <button className={styles.megaHead} onClick={() => pick(node.key)}>
                  {node.label}
                </button>
                {node.subs.map((sub) => (
                  <button key={sub.key} className={styles.megaSub} onClick={() => pick(node.key, sub.key)}>
                    <span>{sub.label}</span>
                    <span className={styles.subCount}>{sub.count}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {featured.map((node, i) => (
        <div
          key={node.key}
          className={styles.item}
          onMouseEnter={() => setOpenKey(node.key)}
          onMouseLeave={() => setOpenKey((k) => (k === node.key ? null : k))}
        >
          <button className={styles.cat} onClick={() => pick(node.key)}>
            {node.label}
            {node.subs.length > 0 && (
              <ChevronDown size={13} className={cn(styles.chev, openKey === node.key && styles.chevOpen)} />
            )}
          </button>

          {node.subs.length > 0 && openKey === node.key && (
            <div className={cn(styles.dropdown, i >= featured.length - 1 && styles.dropdownEnd)}>
              {node.subs.map((sub) => (
                <button key={sub.key} className={styles.subItem} onClick={() => pick(node.key, sub.key)}>
                  <span>{sub.label}</span>
                  <span className={styles.subCount}>{sub.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
