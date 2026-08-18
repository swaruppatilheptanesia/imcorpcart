import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Tag, Truck, ArrowRight } from 'lucide-react';
import { Field, Input, Button, Logo } from '@/components';
import { login, persistSession } from '@/data/unified-auth';
import styles from './Auth.module.css';

export function Login({
  onNext,
  onDone,
  onRegister,
}: {
  onNext: (challengeToken: string) => void;
  onDone: (portalPath: string) => void;
  onRegister: () => void;
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password.trim()) {
      setError(true);
      return;
    }
    setBusy(true);
    setApiError(null);
    try {
      const res = await login(email.trim(), password);
      // 2FA disabled (beta): signed in directly — route to the role's portal.
      if (res.accessToken && res.user) {
        onDone(persistSession(res.accessToken, res.user));
        return;
      }
      // In dev the OTP is printed to the backend console AND returned here.
      if (res.devOtp) console.info(`[dev] OTP: ${res.devOtp}`);
      onNext(res.challengeToken);
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.split}>
      {/* Left marketing hero (Samsung B2B prelogin style) */}
      <aside className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.brand}>
            <Logo size={34} />
            <span className={styles.word} style={{ color: '#fff' }}>imcorpcart</span>
          </div>
          <h2 className={styles.heroTitle}>Corporate Employee Purchase Program</h2>
          <p className={styles.heroSub}>
            Negotiated corporate rates on phones, accessories and bags — for your whole organisation.
          </p>
          <ul className={styles.heroList}>
            <li><Tag size={18} /> Exclusive EPP pricing, unlocked after sign-in</li>
            <li><ShieldCheck size={18} /> Company-verified accounts &amp; secure checkout</li>
            <li><Truck size={18} /> Fast, tracked delivery to your doorstep</li>
          </ul>
          <button className={styles.browseLink} onClick={() => navigate('/shop')}>
            Browse products <ArrowRight size={16} />
          </button>
        </div>
      </aside>

      {/* Right sign-in pane */}
      <div className={styles.pane}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <Logo size={30} />
          <span className={styles.word}>imcorpcart</span>
        </div>

        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.subheading}>One account — we'll take you straight to your portal.</p>

        <div className={styles.form}>
          <Field label="Email" error={error && !email.trim() ? 'Enter your email' : undefined}>
            <Input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(false);
              }}
            />
          </Field>
          <Field
            label="Password"
            error={error && !password.trim() ? 'Enter your password' : undefined}
          >
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </Field>

          {apiError && (
            <div className={styles.hint} style={{ color: 'var(--error)', margin: 0 }}>
              {apiError}
            </div>
          )}

          <Button size="lg" block onClick={submit} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>

        <button className={styles.linkBtn} onClick={onRegister}>
          New employee? Create an account
        </button>
      </div>
      </div>
    </div>
  );
}
