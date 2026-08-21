import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getQrCampaign, type QrCampaignInfo } from '@/data/unified-auth';
import { Login } from './Login';
import { Otp } from './Otp';
import { Register } from './Register';

type Stage = 'login' | 'register' | 'otp';

/** The single door for all four portals, mounted at `/`. Signs the user in
 *  passwordlessly (email → emailed OTP) and routes them to the portal their
 *  role maps to. No auto-redirect for already-signed-in visitors —
 *  signing out of one portal must not bounce the user into another.
 *
 *  A scanned exhibition QR lands here as `/?qr=<token>`: the gate opens the
 *  registration stage directly with the campaign's discount banner. */
export function AuthGate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qrToken = params.get('qr');

  const [stage, setStage] = useState<Stage>(qrToken ? 'register' : 'login');
  const [challengeToken, setChallengeToken] = useState('');
  const [email, setEmail] = useState('');
  const [campaign, setCampaign] = useState<QrCampaignInfo | null>(null);

  useEffect(() => {
    if (!qrToken) return;
    let cancelled = false;
    getQrCampaign(qrToken).then((c) => !cancelled && setCampaign(c));
    return () => {
      cancelled = true;
    };
  }, [qrToken]);

  const done = (portalPath: string) => navigate(portalPath);
  const toOtp = (ct: string, addr: string) => {
    setChallengeToken(ct);
    setEmail(addr);
    setStage('otp');
  };

  if (stage === 'register')
    return (
      <Register
        onNext={toOtp}
        onDone={done}
        onBack={() => setStage('login')}
        qrToken={qrToken}
        campaign={campaign}
      />
    );
  if (stage === 'otp')
    return <Otp challengeToken={challengeToken} email={email} onDone={done} onBack={() => setStage('login')} />;
  return <Login onNext={toOtp} onDone={done} onRegister={() => setStage('register')} />;
}
