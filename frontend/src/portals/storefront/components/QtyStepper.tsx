import { Minus, Plus } from 'lucide-react';
import styles from './QtyStepper.module.css';

export function QtyStepper({
  value,
  onChange,
  max = 99,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <div className={styles.stepper}>
      <button
        className={styles.btn}
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        aria-label="Decrease"
      >
        <Minus size={15} />
      </button>
      <span className={styles.val}>{value}</span>
      <button
        className={styles.btn}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Increase"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
