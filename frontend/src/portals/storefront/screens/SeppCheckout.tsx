import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, ShieldCheck, Landmark, AlertTriangle, Building2 } from 'lucide-react';
import { Button, Radio, Spinner, useToast } from '@/components';
import { cn } from '@/lib/cn';
import { inr } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { getSeppQuote, createSeppAdvanceOrder } from '@/data/shop-api';
import type { SeppBranch } from '@/data/sepp-types';
import { openRazorpay, RZP_INSTRUMENT, lockToMethod } from '@/lib/razorpay';
import { useStore } from '../store-context';
import styles from './Checkout.module.css';

const fmtAddr = (a: SeppBranch) =>
  [a.line1, a.line2, `${a.city}, ${a.state}`, a.pincode].filter(Boolean).join(', ');

/** Smart EPP request checkout: pick the office branch the lease order ships
 *  to, review the lease figures, pay the leasing company's advance (Razorpay)
 *  and submit the request into HR → leasing approval. No billing address, no
 *  wallet, no coupons — the corporate pays the leasing company via payroll. */
export function SeppCheckout() {
  const navigate = useNavigate();
  const { flash } = useToast();
  const { ready, cart, cartCount, submitSepp, sepp, paymentMethods } = useStore();
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [methodKey, setMethodKey] = useState<string | null>(null);

  const cartKey = cart.map((l) => `${l.itemId}:${l.qty}`).join('|');
  const { data: quote, state, error } = useAsync(() => (ready && cart.length ? getSeppQuote() : Promise.resolve(null)), [ready, cartKey]);

  // Only bounce once the cart has actually loaded (deep links land here before it does).
  useEffect(() => {
    if (ready && cart.length === 0) navigate('/shop/cart');
  }, [ready, cart.length, navigate]);

  // Default to the company's default branch (or the first).
  useEffect(() => {
    if (!quote) return;
    setSelectedId((cur) => cur ?? quote.branches.find((b) => b.isDefault)?.id ?? quote.branches[0]?.id ?? null);
  }, [quote]);

  // Default to the first method once the profile loads. Unlike EPP the order is
  // unaffected by the choice (no surcharge) — it only decides what the Razorpay
  // modal offers.
  useEffect(() => {
    if (methodKey === null && paymentMethods.length) setMethodKey(paymentMethods[0].method);
  }, [paymentMethods, methodKey]);

  if (!ready || cart.length === 0) return null;

  const selected = quote?.branches.find((b) => b.id === selectedId) ?? null;
  const needsPayment = Boolean(quote && quote.advance > 0);
  const selectedMethod = paymentMethods.find((m) => m.method === methodKey) ?? null;
  const canSubmit = Boolean(quote?.canSubmit && selected && !busy && (!needsPayment || selectedMethod));

  const finish = (requestNo: string) => navigate('/shop/sepp/success', { state: { requestNo } });

  const submit = async () => {
    if (!quote || !selected) {
      flash('Choose an office address first');
      return;
    }
    setBusy(true);
    try {
      // No advance → submit straight away.
      if (quote.advance <= 0) {
        const req = await submitSepp(selected.id);
        finish(req.requestNo);
        return;
      }
      // Pay the leasing company's advance, then submit with the signed result. The
      // modal is locked to the chosen method, same as an EPP checkout; here the
      // choice does not move the amount (the advance carries no surcharge).
      const payMethod = selectedMethod?.method;
      const po = await createSeppAdvanceOrder(payMethod);
      let paid = false;
      await openRazorpay({
        key: po.keyId,
        amount: po.amount,
        currency: po.currency,
        order_id: po.rzpOrderId,
        name: 'imcorpcart',
        description: `Smart EPP advance · ${cartCount} item${cartCount > 1 ? 's' : ''}`,
        theme: { color: '#0071e3' },
        prefill: { method: payMethod ? RZP_INSTRUMENT[payMethod]?.method : undefined },
        config: lockToMethod(payMethod),
        handler: (r) => {
          paid = true;
          void (async () => {
            try {
              const req = await submitSepp(selected.id, {
                razorpayOrderId: r.razorpay_order_id,
                razorpayPaymentId: r.razorpay_payment_id,
                razorpaySignature: r.razorpay_signature,
              });
              finish(req.requestNo);
            } catch (e) {
              setBusy(false);
              flash(e instanceof Error ? e.message : 'Could not submit the request');
            }
          })();
        },
        modal: {
          ondismiss: () => {
            if (paid) return;
            setBusy(false);
            flash('Payment cancelled');
          },
        },
        onFailed: (msg) => {
          setBusy(false);
          flash(msg);
          navigate('/shop/failed');
        },
      });
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not submit the request');
      setBusy(false);
    }
  };

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        {/* ── Office branch ── */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardTitle}>Deliver to office</div>
          </div>
          {state === 'loading' && (
            <div style={{ display: 'grid', placeItems: 'center', padding: 20 }}>
              <Spinner size={20} />
            </div>
          )}
          {quote && quote.branches.length === 0 && (
            <div className={styles.muted}>
              <Building2 size={14} /> Your company hasn't added an office address yet — ask your HR admin.
            </div>
          )}
          {quote && quote.branches.length > 0 && (
            <div className={styles.addrList}>
              {quote.branches.map((b) => (
                <button
                  key={b.id}
                  className={cn(styles.addrOption, b.id === selectedId && styles.addrOptionOn)}
                  onClick={() => setSelectedId(b.id)}
                >
                  <Radio checked={b.id === selectedId} />
                  <div>
                    <div className={styles.addrName}>
                      {b.label || b.contactName}
                      {b.isDefault && <span className={styles.defaultTag}>Default</span>}
                    </div>
                    <div className={styles.addrLine}>{fmtAddr(b)}</div>
                    <div className={styles.addrLine}>
                      {b.contactName} · {b.contactPhone}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className={styles.muted} style={{ marginTop: 12 }}>
            <MapPin size={14} /> Smart EPP devices are delivered to your company's office and handed over by HR.
          </div>
        </section>

        {/* ── How it works ── */}
        <section className={styles.card}>
          <div className={styles.cardTitle}>What happens next</div>
          <ol className={styles.steps}>
            <li>
              {quote && quote.advance > 0
                ? `You pay the one-time advance of ${inr(quote.advance)} now (refunded if the request isn't approved).`
                : 'You submit the request — nothing is charged now.'}
            </li>
            <li>Your HR admin reviews and approves the request.</li>
            <li>{sepp?.leasingCompany ?? 'The leasing company'} approves and the order is placed.</li>
            <li>
              The monthly EMI is deducted from your salary for {quote?.quote.tenureMonths ?? sepp?.tenureMonths ?? 12}{' '}
              months. You own the device at the end.
            </li>
          </ol>
          <div className={styles.payNote}>
            <ShieldCheck size={18} />
            <div>
              <div className={styles.payNoteTitle}>Secure payment via Razorpay</div>
              <div className={styles.payNoteSub}>Only the leasing advance is paid online; the lease itself runs through payroll.</div>
            </div>
          </div>
        </section>

        {/* ── Payment method (advance only) ── */}
        {needsPayment && paymentMethods.length > 0 && (
          <section className={styles.card}>
            <div className={styles.cardTitle}>Payment method</div>
            <div className={styles.payMethods}>
              {paymentMethods.map((m) => (
                <button
                  key={m.method}
                  className={cn(styles.payOption, m.method === methodKey && styles.payOptionOn)}
                  onClick={() => setMethodKey(m.method)}
                >
                  <Radio checked={m.method === methodKey} />
                  <div className={styles.payOptionBody}>
                    <div className={styles.payOptionLabel}>{m.label}</div>
                    {/* No surcharge here: the advance is the leasing company's own
                        fee and is refunded in full if the request is declined. */}
                    <div className={styles.payOptionFee}>No fee</div>
                  </div>
                </button>
              ))}
            </div>
            <div className={styles.muted} style={{ marginTop: 12 }}>
              {selectedMethod
                ? `The Razorpay window will open on ${selectedMethod.label.toLowerCase()} only. The ${inr(quote?.advance ?? 0)} advance is the same whichever you pick.`
                : 'Choose how you want to pay the advance.'}
            </div>
          </section>
        )}
      </div>

      <aside className={styles.summary}>
        <div className={styles.summaryTitle}>
          <Landmark size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Smart EPP request
        </div>
        {state === 'error' && (
          <div className={styles.issue}>
            <AlertTriangle size={14} /> {error ?? "Couldn't price this cart on Smart EPP."}
          </div>
        )}
        {quote && (
          <>
            {quote.lines.map((l) => (
              <div key={l.itemId} className={styles.sumRow}>
                <span className={styles.lineName}>
                  {l.name}
                  {l.qty > 1 ? ` × ${l.qty}` : ''}
                </span>
                <span className={styles.tabular}>{inr(l.lineMonthlyEmi)}/mo</span>
              </div>
            ))}
            <div className={styles.divider} />
            <div className={styles.sumRow}>
              <span>Monthly EMI (incl. GST)</span>
              <span className={styles.tabular}>{inr(quote.quote.monthlyRental)}</span>
            </div>
            <div className={styles.sumRow}>
              <span>Net impact after tax saving</span>
              <span className={styles.tabular}>{inr(quote.quote.postTaxDeduction)}/mo</span>
            </div>
            <div className={styles.sumRow}>
              <span>Effective purchase ({quote.quote.tenureMonths} mo)</span>
              <span className={styles.tabular}>{inr(quote.quote.totalPreTaxDeduction)}</span>
            </div>
            <div className={styles.sumRow}>
              <span className={styles.muted}>Limit after this request</span>
              <span className={styles.tabular}>{inr(Math.max(0, quote.available - quote.quote.totalPreTaxDeduction))}</span>
            </div>
            <div className={styles.divider} />
            <div className={styles.total}>
              <span>Pay now</span>
              <span className={styles.tabular}>{inr(quote.advance)}</span>
            </div>
            {quote.issues.map((msg) => (
              <div key={msg} className={styles.issue}>
                <AlertTriangle size={14} /> {msg}
              </div>
            ))}
          </>
        )}

        <Button size="lg" block onClick={submit} disabled={!canSubmit} style={{ marginTop: 16 }}>
          {busy ? 'Processing…' : quote && quote.advance > 0 ? `Pay ${inr(quote.advance)} & submit request` : 'Submit request'}
        </Button>
        <div className={styles.emiHint}>Needs HR + leasing approval before the order is placed.</div>
      </aside>
    </div>
  );
}
