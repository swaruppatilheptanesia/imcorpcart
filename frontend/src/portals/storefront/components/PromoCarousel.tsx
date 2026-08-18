import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAsync } from '@/lib/useAsync';
import { getBanners, getPublicBanners } from '@/data/shop-api';
import { useStore } from '../store-context';
import styles from './PromoCarousel.module.css';

const AUTO_MS = 5000;

// Super-Admin-managed promotional banners at the top of Home. Renders nothing
// when there are no active banners, so Home is unchanged without them.
export function PromoCarousel() {
  const navigate = useNavigate();
  const { authed } = useStore();
  const { data } = useAsync(() => (authed ? getBanners() : getPublicBanners()), [authed]);
  const banners = data ?? [];
  const [idx, setIdx] = useState(0);
  const touchX = useRef<number | null>(null);

  const count = banners.length;
  const go = (i: number) => setIdx(((i % count) + count) % count);

  // Auto-advance (paused implicitly while there's a single banner).
  useEffect(() => {
    if (count <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % count), AUTO_MS);
    return () => clearInterval(t);
  }, [count]);

  if (count === 0) return null;

  const open = (linkUrl: string | null) => {
    if (!linkUrl) return;
    if (linkUrl.startsWith('/')) navigate(linkUrl);
    else window.open(linkUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className={styles.carousel}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1));
        touchX.current = null;
      }}
    >
      <div className={styles.track} style={{ transform: `translateX(-${idx * 100}%)` }}>
        {banners.map((b) => (
          <button
            key={b.id}
            className={`${styles.slide} ${b.linkUrl ? styles.slideClickable : ''}`}
            onClick={() => open(b.linkUrl)}
            tabIndex={b.linkUrl ? 0 : -1}
            aria-label={b.title}
          >
            <img className={styles.img} src={b.imageUrl} alt={b.title} loading="eager" />
          </button>
        ))}
      </div>

      {count > 1 && (
        <>
          <button className={`${styles.nav} ${styles.prev}`} onClick={() => go(idx - 1)} aria-label="Previous banner">
            <ChevronLeft size={20} />
          </button>
          <button className={`${styles.nav} ${styles.next}`} onClick={() => go(idx + 1)} aria-label="Next banner">
            <ChevronRight size={20} />
          </button>
          <div className={styles.dots}>
            {banners.map((b, i) => (
              <button
                key={b.id}
                className={`${styles.dot} ${i === idx ? styles.dotActive : ''}`}
                onClick={() => go(i)}
                aria-label={`Go to banner ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
