import { cn } from '@/lib/cn';
import styles from './Misc.module.css';

/** Circular avatar — initials on accent→darker (or custom) gradient. */
export function Avatar({
  initials,
  size = 34,
  bg,
}: {
  initials: string;
  size?: number;
  bg?: string;
}) {
  const background = bg
    ? `linear-gradient(135deg, ${bg}, color-mix(in srgb, ${bg} 55%, #000))`
    : 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 50%, #000))';
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, background, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

/** Rotating spinner. */
export function Spinner({ size = 18 }: { size?: number }) {
  return <span className={styles.spinner} style={{ width: size, height: size }} />;
}

/** Shimmer bar placeholder. */
export function Skeleton({
  h = 12,
  w = '100%',
  radius = 6,
}: {
  h?: number;
  w?: number | string;
  radius?: number;
}) {
  return <span className={styles.skeleton} style={{ height: h, width: w, borderRadius: radius }} />;
}

/** Gradient "device" thumbnail in a dark well (product image placeholder). */
export function ProductThumb({
  g1,
  g2,
  w = 34,
  h = 44,
}: {
  g1: string;
  g2: string;
  w?: number;
  h?: number;
}) {
  // The adapter passes a real image URL through g1/g2 when one exists; otherwise
  // they're gradient hex colors (the placeholder).
  const isUrl = g1.startsWith('/') || g1.startsWith('http');
  return (
    <span className={styles.thumb} style={{ width: w, height: h }}>
      {isUrl ? (
        <img
          src={g1}
          alt=""
          className={styles.thumbInner}
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
        />
      ) : (
        <span className={styles.thumbInner} style={{ background: `linear-gradient(155deg, ${g1}, ${g2})` }} />
      )}
    </span>
  );
}

/** Thin usage/progress bar. */
export function ProgressBar({ pct, tone = 'var(--accent)' }: { pct: number; tone?: string }) {
  return (
    <span className={styles.progress}>
      <span
        className={styles.progressFill}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: tone }}
      />
    </span>
  );
}

/** Vendor color dot + name row. */
export function VendorTag({ name, color }: { name: string; color: string }) {
  return (
    <span className={styles.vendor}>
      <span className={styles.vendorDot} style={{ background: color }} />
      {name}
    </span>
  );
}

export function Overline({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(styles.overline, className)}>{children}</div>;
}
