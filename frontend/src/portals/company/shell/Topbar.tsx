import { Plus } from 'lucide-react';
import { Button } from '@/components';
import { titles } from '../nav';
import styles from '../../super-admin/shell/Topbar.module.css';

interface Props {
  route: string;
  onAction?: () => void;
  actionLabel?: string;
}

export function Topbar({ route, onAction, actionLabel }: Props) {
  const meta = titles[route] ?? { title: '', sub: '' };
  return (
    <header className={styles.topbar}>
      <div className={styles.titles}>
        <div className={styles.title}>{meta.title}</div>
        <div className={styles.sub}>{meta.sub}</div>
      </div>
      <div className={styles.spacer} />
      {actionLabel && onAction && (
        <Button size="sm" icon={<Plus size={16} strokeWidth={2.2} />} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </header>
  );
}
