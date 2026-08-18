import { Plus } from 'lucide-react';
import { Button, Segmented } from '@/components';
import type { DateRange } from '@/data/types';
import { titles } from '../nav';
import styles from './Topbar.module.css';

const RANGES: { value: DateRange; label: string }[] = [
  { value: '7D', label: '7D' },
  { value: '30D', label: '30D' },
  { value: 'QTD', label: 'QTD' },
  { value: 'YTD', label: 'YTD' },
];

interface Props {
  route: string;
  dateRange: DateRange;
  onDateRange: (r: DateRange) => void;
  onAction?: () => void;
  actionLabel?: string;
}

export function Topbar({ route, dateRange, onDateRange, onAction, actionLabel }: Props) {
  const meta = titles[route] ?? { title: '', sub: '' };
  const showDate = route === 'dashboard';
  return (
    <header className={styles.topbar}>
      <div className={styles.titles}>
        <div className={styles.title}>{meta.title}</div>
        <div className={styles.sub}>{meta.sub}</div>
      </div>
      <div className={styles.spacer} />
      {showDate && (
        <Segmented options={RANGES} value={dateRange} onChange={onDateRange} tone="plain" />
      )}
      {actionLabel && onAction && (
        <Button size="sm" icon={<Plus size={16} strokeWidth={2.2} />} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </header>
  );
}
