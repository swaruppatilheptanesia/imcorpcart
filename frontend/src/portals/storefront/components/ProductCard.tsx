import { useNavigate } from 'react-router-dom';
import { Heart, Gift } from 'lucide-react';
import { cn } from '@/lib/cn';
import { inr } from '@/lib/format';
import type { StoreProduct } from '@/data/store-types';
import { useStore } from '../store-context';
import { RatingStars } from './RatingStars';
import styles from './ProductCard.module.css';

// Per-category image aspect — large, Amazon-style image area (phones tall,
// accessories/bags roughly square). New/unknown categories fall back to square.
const DEFAULT_ASPECT = '1 / 1';
const ASPECT: Record<string, string> = {
  phones: '150 / 185',
  accessories: '1 / 1',
  bags: '150 / 140',
};

export function ProductCard({ p, list = false }: { p: StoreProduct; list?: boolean }) {
  const navigate = useNavigate();
  const { toggleWishlist, isWished, authed } = useStore();
  const wished = isWished(p.id);

  // Amazon-style spec highlights under the title: the first few spec values
  // ("6.7\" OLED · 120Hz | Exynos 1480 | …"). Packaging rows aren't a selling point.
  const specLine = p.specs
    .filter((s) => s.k.toLowerCase() !== 'in the box')
    .slice(0, list ? 4 : 3)
    .map((s) => s.v)
    .join('  |  ');

  // This SKU's own colour · variant (families are shown one card per SKU), so
  // same-name variants stay distinguishable — e.g. "Blue · 128GB".
  const variantLabel = [p.optionColor, p.optionVariant].filter(Boolean).join(' · ');

  return (
    <button className={cn(styles.card, list && styles.listCard)} onClick={() => navigate(`/shop/product/${p.id}`)}>
      <div className={styles.well} style={{ aspectRatio: list ? '1 / 1' : ASPECT[p.group] ?? DEFAULT_ASPECT }}>
        {p.image ? (
          <img className={styles.img} src={p.image} alt={p.name} />
        ) : (
          <span className={styles.device} style={{ background: `linear-gradient(155deg, ${p.g1}, ${p.g2})` }} />
        )}
        <span
          role="button"
          tabIndex={0}
          className={cn(styles.heart, wished && styles.heartOn)}
          onClick={(e) => {
            e.stopPropagation();
            toggleWishlist(p.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              toggleWishlist(p.id);
            }
          }}
          aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'}
        >
          <Heart size={15} fill={wished ? 'currentColor' : 'none'} />
        </span>
      </div>

      <div className={styles.body}>
        {p.brand && (
          <div className={styles.vendorRow}>
            <span className={styles.vendor}>{p.brand}</span>
          </div>
        )}
        <div className={styles.name}>{p.name}</div>
        {variantLabel && <div className={styles.colours}>{variantLabel}</div>}
        {p.reviews > 0 && (
          <div className={styles.rating}>
            <RatingStars rating={p.rating} reviews={p.reviews} />
          </div>
        )}
        {specLine && <div className={styles.specs}>{specLine}</div>}
        <div className={styles.priceRow}>
          <span className={styles.price}>{inr(p.price)}</span>
          {p.mrp > p.price && <span className={styles.mrp}>{inr(p.mrp)}</span>}
          <span className={styles.priceTag}>{authed ? 'EPP' : 'MOP'}</span>
        </div>
        {p.cashback > 0 && <div className={styles.cashback}>Earn {inr(p.cashback)} cashback</div>}
        {p.freebie.enabled && (
          <div className={styles.freebie}>
            <Gift size={11} /> Free gift
          </div>
        )}
      </div>
    </button>
  );
}
