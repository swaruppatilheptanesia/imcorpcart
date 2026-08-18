import { useEffect, useState } from 'react';
import { Input } from '@/components';
import { PRICE_FLOOR, PRICE_CEIL } from '@/data/store-types';
import styles from './PriceSlider.module.css';

const STEP = 1000;

// Dual-thumb range + manual min/max entry. The slider and the two number inputs
// both drive the same onChange(min, max); inputs commit on blur/Enter.
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

  // Local text mirrors the committed min/max, re-synced when they change (slider
  // drag, "Clear all", catalog-fitted ceil) — so typing isn't clobbered mid-edit.
  const [minText, setMinText] = useState(String(min));
  const [maxText, setMaxText] = useState(String(max));
  useEffect(() => setMinText(String(min)), [min]);
  useEffect(() => setMaxText(String(max)), [max]);

  const clamp = (v: number) => Math.min(ceil, Math.max(PRICE_FLOOR, v));

  const commitMin = () => {
    const n = parseInt(minText.replace(/\D/g, ''), 10);
    if (Number.isNaN(n)) return setMinText(String(min)); // revert blank/garbage
    const next = Math.min(clamp(n), max); // enforce min ≤ max
    onChange(next, max);
    setMinText(String(next));
  };
  const commitMax = () => {
    const n = parseInt(maxText.replace(/\D/g, ''), 10);
    if (Number.isNaN(n)) return setMaxText(String(max));
    const next = Math.max(clamp(n), min); // enforce max ≥ min
    onChange(min, next);
    setMaxText(String(next));
  };

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
      <div className={styles.inputs}>
        <Input
          prefix="₹"
          inputSize="sm"
          type="text"
          inputMode="numeric"
          aria-label="Minimum price"
          value={minText}
          onChange={(e) => setMinText(e.target.value.replace(/\D/g, ''))}
          onBlur={commitMin}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className={styles.dash}>–</span>
        <Input
          prefix="₹"
          inputSize="sm"
          type="text"
          inputMode="numeric"
          aria-label="Maximum price"
          value={maxText}
          onChange={(e) => setMaxText(e.target.value.replace(/\D/g, ''))}
          onBlur={commitMax}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
    </div>
  );
}
