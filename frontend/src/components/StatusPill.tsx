import type { SemanticTone } from '@/data/types';
import styles from './StatusPill.module.css';

interface Props {
  label: string;
  tone: SemanticTone;
  size?: 'sm' | 'md';
}

const toneColor: Record<SemanticTone, string> = {
  success: '#1E9E6A',
  warning: '#E0921A',
  error: '#E0453B',
  info: '#2B7BE4',
  neutral: '#949BA7',
};

export function StatusPill({ label, tone, size = 'sm' }: Props) {
  const c = toneColor[tone];
  const isNeutral = tone === 'neutral';
  return (
    <span
      className={`${styles.pill} ${styles[size]}`}
      style={{
        color: isNeutral ? 'var(--text3)' : c,
        background: `color-mix(in srgb, ${c} ${isNeutral ? 16 : 14}%, var(--surface))`,
      }}
    >
      {label}
    </span>
  );
}
