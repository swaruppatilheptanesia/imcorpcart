import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import styles from './Select.module.css';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** md = toolbar filter (--control-h); sm = in-row control (--control-h-sm). */
  selectSize?: 'sm' | 'md';
  /** Stretch to the container — form fields want this, toolbar filters usually don't. */
  block?: boolean;
}

/**
 * The one dropdown. Before this there were ~20 raw `<select>` elements across the admin
 * portal with 3 heights, 4 radii, 4 font sizes and two different arrows — five classes
 * drew a custom chevron, the other eleven left the OS triangle, so adjacent nav items
 * rendered visibly different controls.
 *
 * The chevron is a real element taking `currentColor`, not a `background-image`. The old
 * custom arrow inlined an SVG with a hardcoded `#98989d` stroke that matched no token, so
 * it stayed the same mid-grey in dark mode.
 */
export function Select({ selectSize = 'md', block, className, children, ...rest }: SelectProps) {
  return (
    <span className={cn(styles.wrap, block && styles.block)}>
      <select className={cn(styles.select, styles[selectSize], className)} {...rest}>
        {children}
      </select>
      <ChevronDown size={selectSize === 'sm' ? 14 : 16} className={styles.chevron} aria-hidden />
    </span>
  );
}
