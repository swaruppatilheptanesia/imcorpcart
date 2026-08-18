import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import styles from './Overlay.module.css';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/** Right slide-in drawer (440px default). */
export function Drawer({ open, onClose, title, children, footer, width = 440 }: DrawerProps) {
  useEscape(onClose);
  if (!open) return null;
  return (
    <div className={styles.scrim} onMouseDown={onClose}>
      <aside
        className={styles.drawer}
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className={styles.head}>
          <h3 className={styles.title}>{title}</h3>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={styles.drawerBody}>{children}</div>
        {footer && <div className={styles.drawerFooter}>{footer}</div>}
      </aside>
    </div>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/** Centered modal dialog. */
export function Modal({ open, onClose, title, children, footer, width = 460 }: ModalProps) {
  useEscape(onClose);
  if (!open) return null;
  return (
    <div className={cn(styles.scrim, styles.center)} onMouseDown={onClose}>
      <div
        className={styles.modal}
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className={styles.modalHead}>
          <h3 className={styles.title}>{title}</h3>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={styles.modalBody}>{children}</div>
        {footer && <div className={styles.modalFooter}>{footer}</div>}
      </div>
    </div>
  );
}
