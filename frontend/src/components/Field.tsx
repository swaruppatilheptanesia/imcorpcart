import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import styles from './Field.module.css';

interface FieldProps {
  label?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

/** Label + control wrapper with optional error/hint lines. */
export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <div className={styles.field}>
      {label && <label className={styles.label}>{label}</label>}
      {children}
      {error && <div className={styles.error}>{error}</div>}
      {hint && !error && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  prefix?: string;
  invalid?: boolean;
  accent?: boolean;
  inputSize?: 'sm' | 'md';
}

export function Input({
  prefix,
  invalid,
  accent,
  inputSize = 'md',
  className,
  ...rest
}: InputProps) {
  const input = (
    <input
      className={cn(
        styles.input,
        styles[inputSize],
        invalid && styles.invalid,
        accent && styles.accent,
        prefix && styles.hasPrefix,
        className
      )}
      {...rest}
    />
  );
  if (!prefix) return input;
  return (
    <div className={cn(styles.wrap, invalid && styles.invalid, accent && styles.accent)}>
      <span className={styles.prefix}>{prefix}</span>
      {input}
    </div>
  );
}
