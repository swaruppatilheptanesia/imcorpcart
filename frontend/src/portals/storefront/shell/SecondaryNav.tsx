import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StoreCategory } from '@/data/store-types';
import { useStore } from '../store-context';
import { categoryTree } from '../data';
import styles from './SecondaryNav.module.css';

export function SecondaryNav() {
  const navigate = useNavigate();
  const { setFilters } = useStore();
  const tree = categoryTree();
  // Which category's subcategory dropdown is open (hover-driven).
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

      {tree.map((node) => (
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
            <div className={styles.dropdown}>
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
