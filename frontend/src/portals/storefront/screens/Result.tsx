import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components';
import styles from './Result.module.css';

export function Result({ kind }: { kind: 'success' | 'failed' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const orderNo = (location.state as { orderNo?: string } | null)?.orderNo ?? null;

  if (kind === 'failed') {
    return (
      <div className={styles.center}>
        <span className={styles.iconError}>
          <XCircle size={40} />
        </span>
        <div className={styles.resultTitle}>Payment failed</div>
        <div className={styles.resultSub}>Your payment couldn't be processed. No amount was charged.</div>
        <div className={styles.actions}>
          <Button size="lg" onClick={() => navigate('/shop/checkout')}>
            Try again
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate('/shop/home')}>
            Back to store
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.center}>
      <span className={styles.iconOk}>
        <CheckCircle2 size={40} />
      </span>
      <div className={styles.resultTitle}>Order placed</div>
      <div className={styles.resultSub}>
        {orderNo ? (
          <>Your order <strong>{orderNo}</strong> is confirmed. We'll email you the invoice and tracking updates.</>
        ) : (
          <>Your order is confirmed. We'll email you the invoice and tracking updates.</>
        )}
      </div>
      <div className={styles.actions}>
        <Button size="lg" onClick={() => navigate('/shop/orders')}>
          Track order
        </Button>
        <Button size="lg" variant="secondary" onClick={() => navigate('/shop/home')}>
          Continue shopping
        </Button>
      </div>
    </div>
  );
}
