import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card } from './Card';
import styles from './DataTable.module.css';

interface TableProps {
  cols: string; // grid-template-columns
  headers: ReactNode[];
  children: ReactNode; // <Row> elements
  footer?: ReactNode;
}

/** Card-wrapped grid table: uppercase header row + hairline body rows. */
export function DataTable({ cols, headers, children, footer }: TableProps) {
  return (
    <Card pad="none" className={styles.card}>
      <div className={styles.header} style={{ gridTemplateColumns: cols }}>
        {headers.map((h, i) => (
          <div key={i}>{h}</div>
        ))}
      </div>
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </Card>
  );
}

interface RowProps {
  cols: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function Row({ cols, children, onClick, className }: RowProps) {
  return (
    <div
      className={cn(styles.row, onClick && styles.clickable, className)}
      style={{ gridTemplateColumns: cols }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
