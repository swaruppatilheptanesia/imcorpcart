import { Star } from 'lucide-react';
import styles from './RatingStars.module.css';

export function RatingStars({ rating, reviews, size = 14 }: { rating: number; reviews?: number; size?: number }) {
  return (
    <div className={styles.wrap}>
      <span className={styles.stars}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Star
            key={i}
            size={size}
            fill={i < Math.round(rating) ? 'var(--warning)' : 'none'}
            color="var(--warning)"
          />
        ))}
      </span>
      <span className={styles.num}>{rating.toFixed(1)}</span>
      {reviews !== undefined && <span className={styles.reviews}>({reviews.toLocaleString('en-IN')})</span>}
    </div>
  );
}

// Interactive star picker for the "write a review" form (1–5).
export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className={styles.input}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={styles.inputStar}
          onClick={() => onChange(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          <Star size={26} fill={n <= value ? 'var(--warning)' : 'none'} color="var(--warning)" />
        </button>
      ))}
    </span>
  );
}
