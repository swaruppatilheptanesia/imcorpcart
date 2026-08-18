import { cn } from '@/lib/cn';
import styles from './Timeline.module.css';

interface Props {
  steps: string[];
  /** number of completed steps (1-indexed count). */
  current: number;
  cancelled?: boolean;
}

/** Vertical stepper with filled/empty nodes. */
export function Timeline({ steps, current, cancelled }: Props) {
  return (
    <div className={styles.timeline}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current - 1;
        return (
          <div key={label} className={styles.step}>
            <div className={styles.rail}>
              <span
                className={cn(
                  styles.node,
                  done && !cancelled && styles.nodeDone,
                  active && !cancelled && styles.nodeActive,
                  cancelled && i === current - 1 && styles.nodeCancel
                )}
              />
              {i < steps.length - 1 && <span className={cn(styles.line, done && !cancelled && styles.lineDone)} />}
            </div>
            <div className={styles.stepBody}>
              <div className={cn(styles.label, done && styles.labelDone)}>{label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
