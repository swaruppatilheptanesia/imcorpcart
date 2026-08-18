import { cn } from '@/lib/cn';
import styles from './Controls.module.css';

/** On/off switch — 42×24 track, 20px knob. */
export function Toggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={cn(styles.track, on && styles.trackOn)}
      onClick={onClick}
    >
      <span className={cn(styles.knob, on && styles.knobOn)} />
    </button>
  );
}

/** Accent-fill checkbox with white check. */
export function Checkbox({ checked, onClick }: { checked: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={cn(styles.check, checked && styles.checkOn)}
      onClick={onClick}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}

/** Ring + inner dot radio. */
export function Radio({ checked, onClick }: { checked: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={cn(styles.radio, checked && styles.radioOn)}
      onClick={onClick}
    >
      {checked && <span className={styles.radioDot} />}
    </button>
  );
}
