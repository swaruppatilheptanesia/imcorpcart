import { useRef, useState } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button } from '@/components';
import { login, verifyOtp, persistSession } from '@/data/unified-auth';
import styles from './Auth.module.css';

export function Otp({
  challengeToken,
  email,
  onDone,
  onBack,
}: {
  challengeToken: string;
  email: string;
  onDone: (portalPath: string) => void;
  onBack: () => void;
}) {
  // Local so "Resend code" can swap in a fresh challenge token in place.
  const [ct, setCt] = useState(challengeToken);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [apiError, setApiError] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
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
      const r = await verifyOtp(ct, digits.join(''));
      onDone(persistSession(r.accessToken, r.user));
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setApiError(null);
    setResendMsg(null);
    try {
      const res = await login(email);
      if (res.devOtp) console.info(`[dev] OTP: ${res.devOtp}`);
      setCt(res.challengeToken);
      setDigits(Array(6).fill(''));
      setResendMsg('A new code is on its way.');
      refs.current[0]?.focus();
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Could not resend the code');
    } finally {
      setResending(false);
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

        <h1 className={styles.heading}>Enter your code</h1>
        <p className={styles.subheading}>
          We sent a 6-digit code to {email ? <strong>{email}</strong> : 'your email'}.
        </p>

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
        {resendMsg && !apiError && (
          <p className={styles.hint} style={{ color: 'var(--success)', marginTop: 0 }}>
            {resendMsg}
          </p>
        )}

        <Button size="lg" block disabled={!filled || busy} onClick={verify}>
          {busy ? 'Verifying…' : 'Verify & continue'}
        </Button>

        <button className={styles.linkBtn} onClick={resend} disabled={resending}>
          {resending ? 'Sending…' : "Didn't get it? Resend code"}
        </button>

        <p className={styles.hint}>
          The code is emailed to you and expires shortly. In dev it's also printed to the backend console.
        </p>
      </div>
    </div>
  );
}
