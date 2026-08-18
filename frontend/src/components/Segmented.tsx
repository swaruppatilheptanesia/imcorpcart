import { cn } from '@/lib/cn';
import styles from './Segmented.module.css';

export interface SegOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** accent = selected segment uses accent text; fill = accent background; plain = text color. */
  tone?: 'accent' | 'fill' | 'plain';
  size?: 'sm' | 'md';
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = 'accent',
  size = 'md',
}: Props<T>) {
  return (
    <div className={cn(styles.group, styles[size])} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            className={cn(styles.seg, active && styles.active, active && styles[tone])}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
