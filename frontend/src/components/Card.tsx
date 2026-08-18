import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import styles from './Card.module.css';

interface Props extends HTMLAttributes<HTMLDivElement> {
  pad?: 'sm' | 'md' | 'lg' | 'none';
  hover?: boolean;
}

export function Card({ pad = 'md', hover, className, children, ...rest }: Props) {
  return (
    <div className={cn(styles.card, styles[`p_${pad}`], hover && styles.hover, className)} {...rest}>
      {children}
    </div>
  );
}
