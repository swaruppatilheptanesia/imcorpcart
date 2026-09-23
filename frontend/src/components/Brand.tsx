import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { Logo } from './Logo';
import styles from './Brand.module.css';

/**
 * The imcorpcart brand lockup — the mark and the wordmark on one line, with the
 * same optical spacing everywhere it appears (portal sidebars, storefront nav and
 * footer, login/register).
 *
 * Use this rather than composing `<Logo/>` + a wordmark by hand, so the lockup
 * stays uniform. The wordmark inherits `color`, so a caller on a dark ground just
 * sets `color` on the wrapper. `sub` adds the portal label under the wordmark.
 */
export function Brand({
  size = 30,
  wordSize = 15,
  gap = 4,
  sub,
  className,
}: {
  /** Mark height in px. */
  size?: number;
  /** Wordmark font-size in px. */
  wordSize?: number;
  /** Optical space between mark and wordmark in px — the same at any `size`. */
  gap?: number;
  /** Portal label rendered under the wordmark (sidebars). */
  sub?: string;
  className?: string;
}) {
  const vars = {
    '--brand-logo': `${size}px`,
    '--brand-word': `${wordSize}px`,
    '--brand-gap': `${gap}px`,
  } as CSSProperties;

  return (
    <span className={cn(styles.brand, className)} style={vars}>
      <Logo size={size} />
      <span className={styles.text}>
        <span className={styles.word}>imcorpcart</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </span>
    </span>
  );
}
