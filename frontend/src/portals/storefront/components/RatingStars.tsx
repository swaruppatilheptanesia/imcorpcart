import { Star } from 'lucide-react';
import styles from './RatingStars.module.css';

export function RatingStars({ rating, reviews }: { rating: number; reviews?: number }) {
  return (
    <div className={styles.wrap}>
      <span className={styles.stars}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Star
            key={i}
            size={14}
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
