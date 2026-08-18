import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Spinner } from '@/components';
import styles from './Result.module.css';

export function Processing() {
  const navigate = useNavigate();
  const location = useLocation();

  // The order was already placed on the server in Checkout; this is the
  // confirmation animation before the success screen.
  useEffect(() => {
    const t = setTimeout(() => navigate('/shop/success', { replace: true, state: location.state }), 1700);
    return () => clearTimeout(t);
  }, [navigate, location.state]);

  return (
    <div className={styles.center}>
      <Spinner size={34} />
      <div className={styles.processingTitle}>Processing payment…</div>
      <div className={styles.processingSub}>Do not close this window.</div>
    </div>
  );
}
