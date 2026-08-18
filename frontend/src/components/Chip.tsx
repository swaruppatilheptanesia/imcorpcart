import { cn } from '@/lib/cn';
import styles from './Chip.module.css';

interface Props {
  label: string;
  active?: boolean;
  variant?: 'fill' | 'tint' | 'dashed';
  onClick?: () => void;
  color?: string; // optional leading dot
}

export function Chip({ label, active, variant = 'fill', onClick, color }: Props) {
  return (
    <button
      className={cn(styles.chip, active && styles.active, active && styles[variant])}
      onClick={onClick}
      type="button"
    >
      {color && <span className={styles.dot} style={{ background: color }} />}
      {label}
    </button>
  );
}
