import { useRef, useState } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button } from '@/components';
import { verifyOtp, persistSession } from '@/data/unified-auth';
import styles from './Auth.module.css';

export function Otp({
  challengeToken,
  onDone,
  onBack,
}: {
  challengeToken: string;
  onDone: (portalPath: string) => void;
  onBack: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const set = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    setApiError(null);
    if (d && i < 5) refs.current[i + 1]?.focus();
  };

  const filled = digits.every((d) => d !== '');

  const verify = async () => {
    setBusy(true);
    setApiError(null);
    try {
      const r = await verifyOtp(challengeToken, digits.join(''));
      onDone(persistSession(r.accessToken, r.user));
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <button className={styles.back} onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>

        <span className={styles.lockTile}>
          <ShieldCheck size={22} />
        </span>

        <h1 className={styles.heading}>Verify it's you</h1>
        <p className={styles.subheading}>Enter the 6-digit code sent to your device.</p>

        <div className={styles.otpRow}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => (refs.current[i] = el)}
              className={styles.otpBox}
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
              }}
            />
          ))}
        </div>

        {apiError && (
          <p className={styles.hint} style={{ color: 'var(--error)', marginTop: 0 }}>
            {apiError}
          </p>
        )}

        <Button size="lg" block disabled={!filled || busy} onClick={verify}>
          {busy ? 'Verifying…' : 'Verify & continue'}
        </Button>
        <p className={styles.hint}>
          In dev, the 6-digit code is printed to the backend console (and browser dev-tools).
        </p>
      </div>
    </div>
  );
}
