import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Landmark } from 'lucide-react';
import { Button } from '@/components';
import styles from './Result.module.css';

export function Result({ kind }: { kind: 'success' | 'failed' | 'sepp' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const st = (location.state as { orderNo?: string; requestNo?: string } | null) ?? null;
  const orderNo = st?.orderNo ?? null;
  const requestNo = st?.requestNo ?? null;

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

  // Smart EPP: the request is in, now it waits for HR → leasing approval.
  if (kind === 'sepp') {
    return (
      <div className={styles.center}>
        <span className={styles.iconOk}>
          <Landmark size={40} />
        </span>
        <div className={styles.resultTitle}>Request submitted</div>
        <div className={styles.resultSub}>
          {requestNo ? (
            <>Your Smart EPP request <strong>{requestNo}</strong> is with your HR admin for approval. We'll notify you at each step — the order is placed once the leasing company approves.</>
          ) : (
            <>Your Smart EPP request is with your HR admin for approval. We'll notify you at each step.</>
          )}
        </div>
        <div className={styles.actions}>
          <Button size="lg" onClick={() => navigate(requestNo ? `/shop/sepp/requests/${requestNo}` : '/shop/orders')}>
            Track request
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate('/shop/home')}>
            Continue shopping
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
