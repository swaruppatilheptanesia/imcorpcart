import { inr } from '@/lib/format';
import { PRICE_FLOOR, PRICE_CEIL } from '@/data/store-types';
import styles from './PriceSlider.module.css';

const STEP = 1000;

// Dual-thumb range: two overlaid native range inputs with an accent fill between.
export function PriceSlider({
  min,
  max,
  ceil = PRICE_CEIL,
  onChange,
}: {
  min: number;
  max: number;
  ceil?: number; // slider max, auto-fitted to the catalog (defaults to PRICE_CEIL)
  onChange: (min: number, max: number) => void;
}) {
  const pct = (v: number) => ((v - PRICE_FLOOR) / (ceil - PRICE_FLOOR)) * 100;

  return (
    <div className={styles.wrap}>
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={{ left: `${pct(min)}%`, right: `${100 - pct(max)}%` }}
        />
        <input
          type="range"
          className={styles.range}
          min={PRICE_FLOOR}
          max={ceil}
          step={STEP}
          value={min}
          onChange={(e) => onChange(Math.min(Number(e.target.value), max - STEP), max)}
        />
        <input
          type="range"
          className={styles.range}
          min={PRICE_FLOOR}
          max={ceil}
          step={STEP}
          value={max}
          onChange={(e) => onChange(min, Math.max(Number(e.target.value), min + STEP))}
        />
      </div>
      <div className={styles.labels}>
        <span>{inr(min)}</span>
        <span>{inr(max)}</span>
      </div>
    </div>
  );
}
