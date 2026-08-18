import { useState } from 'react';
import { ArrowLeft, BadgePercent, Clock } from 'lucide-react';
import { Field, Input, Button, Logo } from '@/components';
import { register, persistSession, isFreeMailEmail, GSTIN_RE, type QrCampaignInfo } from '@/data/unified-auth';
import styles from './Auth.module.css';

// Indian 10-digit mobile: optional +91/0 prefix, leading 6–9, then 9 digits.
// Mirrors the backend zod rule (spaces/dashes/() are stripped before testing).
const MOBILE_RE = /^(\+91|0)?[6-9]\d{9}$/;
const normalizePhone = (v: string) => v.replace(/[\s\-()]/g, '');

export function Register({
  onNext,
  onDone,
  onBack,
  qrToken = null,
  campaign = null,
}: {
  onNext: (challengeToken: string) => void;
  onDone: (portalPath: string) => void;
  onBack: () => void;
  /** Exhibition QR deep link (?qr=<token>) + its resolved campaign info. */
  qrToken?: string | null;
  campaign?: QrCampaignInfo | null;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [gstin, setGstin] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once registration succeeds and the account is pending Super Admin approval.
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);

  // Personal email (gmail, yahoo, …) → the company can't be resolved from the
  // domain, so the registrant supplies their company's GSTIN + name instead.
  const freeMail = isFreeMailEmail(email);
  const gstinOk = GSTIN_RE.test(gstin.trim().toUpperCase());
  const phoneOk = MOBILE_RE.test(normalizePhone(phone));

  const submit = async () => {
    const badGstinFlow = freeMail && (!gstinOk || !companyName.trim());
    if (!fullName.trim() || !email.trim() || !phoneOk || password.length < 6 || badGstinFlow) {
      setError(true);
      return;
    }
    setBusy(true);
    setApiError(null);
    try {
      const res = await register({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        phone: normalizePhone(phone),
        gstin: freeMail ? gstin.trim().toUpperCase() : undefined,
        companyName: freeMail ? companyName.trim() : undefined,
        // Only send the token for a live campaign — a dead one registers normally.
        qrToken: campaign?.live && qrToken ? qrToken : undefined,
      });
      // Account created but pending Super Admin approval — show the notice, no login.
      if (res.pending) {
        setPendingMsg(res.message);
        return;
      }
      // 2FA disabled (beta): signed in directly — route to the role's portal.
      if (res.accessToken && res.user) {
        onDone(persistSession(res.accessToken, res.user));
        return;
      }
      if (res.devOtp) console.info(`[dev] OTP: ${res.devOtp}`);
      onNext(res.challengeToken);
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  if (pendingMsg) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <Logo size={30} />
            <span className={styles.word}>imcorpcart</span>
          </div>
          <div className={styles.qrBanner} style={{ marginTop: 8 }}>
            <Clock size={18} />
            <span>{pendingMsg}</span>
          </div>
          <h1 className={styles.heading}>Registration received</h1>
          <p className={styles.subheading}>
            An administrator will review and activate your account shortly. You'll be able to sign in once
            it's approved. In the meantime you can keep browsing the store.
          </p>
          <Button size="lg" block onClick={onBack} style={{ marginTop: 8 }}>
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <button className={styles.back} onClick={onBack}>
          <ArrowLeft size={16} /> Back to sign in
        </button>
        <div className={styles.brand}>
          <Logo size={30} />
          <span className={styles.word}>imcorpcart</span>
        </div>

        <h1 className={styles.heading}>Create your account</h1>
        <p className={styles.subheading}>
          Register with your <strong>organisation email</strong>. We'll link you to your company
          automatically — or set it up if you're the first to join.
        </p>

        {qrToken && campaign?.live && (
          <div className={styles.qrBanner}>
            <BadgePercent size={18} />
            <span>
              <strong>{campaign.name}</strong> — register now and get{' '}
              <strong>{campaign.discountPercent}% off</strong> your purchase.
            </span>
          </div>
        )}
        {qrToken && campaign && !campaign.live && (
          <div className={styles.qrBannerDead}>
            This campaign has ended — you can still register, without the discount.
          </div>
        )}

        <div className={styles.form}>
          <Field label="Full name" error={error && !fullName.trim() ? 'Enter your name' : undefined}>
            <Input placeholder="Your name" value={fullName} onChange={(e) => { setFullName(e.target.value); setError(false); }} />
          </Field>
          <Field label="Work email" error={error && !email.trim() ? 'Enter your work email' : undefined}>
            <Input type="email" placeholder="you@company.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(false); }} />
          </Field>
          <Field label="Mobile number" error={error && !phoneOk ? 'Enter a valid 10-digit mobile number' : undefined}>
            <Input type="tel" placeholder="+91 98765 43210" value={phone} onChange={(e) => { setPhone(e.target.value); setError(false); }} />
          </Field>
          <Field label="Password" error={error && password.length < 6 ? 'At least 6 characters' : undefined}>
            <Input
              type="password"
              placeholder="Create a password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(false); }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </Field>

          {freeMail && (
            <>
              <p className={styles.hint} style={{ margin: 0 }}>
                Personal email detected — enter your company's GSTIN and name. Our team will
                contact you to set up your company's HR portal access.
              </p>
              <Field
                label="Company GSTIN"
                error={error && !gstinOk ? 'Enter a valid 15-character GSTIN' : undefined}
              >
                <Input
                  placeholder="e.g. 27ABCDE1234F1Z5"
                  value={gstin}
                  maxLength={15}
                  onChange={(e) => { setGstin(e.target.value.toUpperCase()); setError(false); }}
                />
              </Field>
              <Field
                label="Company name"
                error={error && !companyName.trim() ? 'Enter your company name' : undefined}
              >
                <Input
                  placeholder="Your company"
                  value={companyName}
                  onChange={(e) => { setCompanyName(e.target.value); setError(false); }}
                />
              </Field>
            </>
          )}

          {apiError && (
            <div className={styles.hint} style={{ color: 'var(--error)', margin: 0 }}>
              {apiError}
            </div>
          )}

          <Button size="lg" block onClick={submit} disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </Button>
        </div>
        <p className={styles.hint}>Your company admin can be granted portal access later by the platform team.</p>
      </div>
    </div>
  );
}
