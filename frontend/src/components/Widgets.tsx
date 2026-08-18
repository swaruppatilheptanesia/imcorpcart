import type { ReactNode } from 'react';
import { Card } from './Card';
import { Button } from './Button';
import styles from './Widgets.module.css';

/** Small stat card: label + big tabular value + optional delta. */
export function StatCard({
  label,
  value,
  delta,
  deltaTone = 'success',
  sub,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: 'success' | 'error';
  sub?: string;
}) {
  return (
    <Card className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {(delta || sub) && (
        <div className={styles.statFoot}>
          {delta && (
            <span className={deltaTone === 'success' ? styles.up : styles.down}>▲ {delta}</span>
          )}
          {sub && <span className={styles.statSub}>{sub}</span>}
        </div>
      )}
    </Card>
  );
}

/** Centered empty state: icon tile + title + sub + optional action. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  tone = 'neutral',
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
  tone?: 'neutral' | 'error';
}) {
  return (
    <Card className={styles.empty} style={tone === 'error' ? { borderColor: 'color-mix(in srgb, var(--error) 30%, var(--border))' } : undefined}>
      <span className={styles.emptyIcon}>{icon}</span>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.emptyBody}>{body}</div>
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </Card>
  );
}

/** Inline polyline sparkline. */
export function Sparkline({ data, color = 'var(--accent)', width = 220, height = 56 }: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((d, i) => `${(i * step).toFixed(1)},${(height - ((d - min) / span) * (height - 8) - 4).toFixed(1)}`);
  const area = `0,${height} ${pts.join(' ')} ${width},${height}`;
  return (
    <svg width={width} height={height} className={styles.spark} preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
      <polygon points={area} fill={color} opacity="0.08" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Donut chart from [{pct, color}] segments (values should sum to ~100). */
export function Donut({ segments, size = 132 }: {
  segments: { label: string; pct: number; color: string }[];
  size?: number;
}) {
  const r = size / 2 - 12;
  const cx = size / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--hair)" strokeWidth="14" />
      {segments.map((s, i) => {
        const len = (s.pct / 100) * c;
        const el = (
          <circle
            key={i}
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="14"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cx})`}
            strokeLinecap="butt"
          />
        );
        offset += len;
        return el;
      })}
      <text x={cx} y={cx - 2} textAnchor="middle" className={styles.donutBig}>
        {segments[0].pct}%
      </text>
      <text x={cx} y={cx + 14} textAnchor="middle" className={styles.donutSmall}>
        on time
      </text>
    </svg>
  );
}
