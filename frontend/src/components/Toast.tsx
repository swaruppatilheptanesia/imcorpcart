import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import styles from './Toast.module.css';

interface ToastCtx {
  flash: (msg: string) => void;
}
const Ctx = createContext<ToastCtx>({ flash: () => {} });

export function useToast() {
  return useContext(Ctx);
}

/** Provider + bottom-center toast host. flash() auto-dismisses after 1900ms. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flash = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 1900);
  }, []);

  return (
    <Ctx.Provider value={{ flash }}>
      {children}
      {msg && (
        <div className={styles.toast} role="status">
          <span className={styles.iconTile}>
            <Check size={15} strokeWidth={2.6} />
          </span>
          <span className={styles.msg}>{msg}</span>
        </div>
      )}
    </Ctx.Provider>
  );
}
