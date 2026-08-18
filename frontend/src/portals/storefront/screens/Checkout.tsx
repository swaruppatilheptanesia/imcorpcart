import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Plus, Pencil, Check, ShieldCheck } from 'lucide-react';
import { Button, Radio, Toggle, useToast } from '@/components';
import { cn } from '@/lib/cn';
import { inr } from '@/lib/format';
import { getAddresses, createPaymentOrder } from '@/data/shop-api';
import { openRazorpay } from '@/lib/razorpay';
import type { ShopAddress } from '@/data/store-types';
import { useStore } from '../store-context';
import { computeTotals } from '../coupon';
import { AddressModal } from '../overlays/AddressModal';
import styles from './Checkout.module.css';

const fmtAddr = (a: ShopAddress) =>
  [a.line1, a.line2, `${a.city}, ${a.state}`, a.pincode].filter(Boolean).join(', ');

export function Checkout() {
  const navigate = useNavigate();
  const { flash } = useToast();
  const { cart, subtotal, appliedCoupon, cartCount, placeOrder, qrDiscount, checkoutEnabled } = useStore();
  const [busy, setBusy] = useState(false);

  const [addresses, setAddresses] = useState<ShopAddress[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [changingShip, setChangingShip] = useState(false);
  const [billingSame, setBillingSame] = useState(true);
  const [modal, setModal] = useState<{ address: ShopAddress | null; billing: boolean } | null>(null);

  const loadAddresses = (preferId?: string) =>
    getAddresses()
      .then((rows) => {
        setAddresses(rows);
        const ship = rows.filter((a) => !a.isBilling);
        setSelectedId((cur) => preferId ?? cur ?? ship.find((a) => a.isDefault)?.id ?? ship[0]?.id ?? null);
      })
      .catch(() => undefined);

  useEffect(() => {
    void loadAddresses();
  }, []);

  useEffect(() => {
    if (cart.length === 0) navigate('/shop/cart');
  }, [cart.length, navigate]);

  // Launch gate: online checkout is closed until live payments go live. Covers
  // any direct navigation to /shop/checkout (buttons are hidden elsewhere).
  if (!checkoutEnabled) {
    return (
      <div className={styles.closed}>
        <h1 className={styles.closedTitle}>Checkout is launching soon</h1>
        <p className={styles.closedBody}>
          Online ordering isn't open just yet. You can keep browsing and build your cart and wishlist — we'll
          enable checkout shortly.
        </p>
        <Button size="lg" onClick={() => navigate('/shop/home')}>Continue browsing</Button>
      </div>
    );
  }

  if (cart.length === 0) return null;

  const shipping = addresses.filter((a) => !a.isBilling);
  const billingAddr = addresses.find((a) => a.isBilling) ?? null;
  const selected = shipping.find((a) => a.id === selectedId) ?? null;
  const billingReady = billingSame || Boolean(billingAddr);

  // Payment is via Razorpay only — no per-method surcharge (pass 0). A
  // category-scoped QR campaign discounts only that category's items.
  const qrBase = qrDiscount?.categorySlug
    ? cart.filter((l) => l.group === qrDiscount.categorySlug).reduce((s, l) => s + l.price * l.qty, 0)
    : subtotal;
  const t = computeTotals(subtotal, appliedCoupon, 0, qrDiscount?.percent ?? 0, qrBase);

  const submit = async () => {
    if (!selected) {
      flash('Add a delivery address first');
      return;
    }
    setBusy(true);
    const billingId = billingSame ? undefined : billingAddr?.id;
    try {
      // Open a Razorpay order for the server-priced total, take the payment in
      // the modal, then place the order with the signed result.
      const po = await createPaymentOrder(appliedCoupon?.code);
      let paid = false;
      await openRazorpay({
        key: po.keyId,
        amount: po.amount,
        currency: po.currency,
        order_id: po.rzpOrderId,
        name: 'imcorpcart',
        description: `${cartCount} item${cartCount > 1 ? 's' : ''}`,
        theme: { color: '#0071e3' },
        handler: (r) => {
          paid = true;
          void (async () => {
            try {
              const order = await placeOrder(appliedCoupon?.code, selected.id, billingId, {
                razorpayOrderId: r.razorpay_order_id,
                razorpayPaymentId: r.razorpay_payment_id,
                razorpaySignature: r.razorpay_signature,
              });
              navigate('/shop/success', { state: { orderNo: order.orderNo } });
            } catch (e) {
              setBusy(false);
              flash(e instanceof Error ? e.message : 'Could not place order');
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
      flash(e instanceof Error ? e.message : 'Could not place order');
      setBusy(false);
    }
  };

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        {/* ── Shipping address ── */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardTitle}>Delivery address</div>
            <div className={styles.cardActions}>
              {selected && (
                <button className={styles.linkBtn} onClick={() => setModal({ address: selected, billing: false })}>
                  <Pencil size={13} /> Edit
                </button>
              )}
              {shipping.length > 1 && (
                <button className={styles.linkBtn} onClick={() => setChangingShip((v) => !v)}>
                  {changingShip ? 'Done' : 'Change'}
                </button>
              )}
              <button className={styles.linkBtn} onClick={() => setModal({ address: null, billing: false })}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>

          {!selected && <div className={styles.muted}>No saved address. Add a delivery address to continue.</div>}

          {selected && !changingShip && (
            <div className={styles.address}>
              <MapPin size={18} />
              <div>
                <div className={styles.addrName}>{selected.contactName} · {selected.contactPhone}</div>
                <div className={styles.addrLine}>{fmtAddr(selected)}</div>
              </div>
            </div>
          )}

          {changingShip && (
            <div className={styles.addrList}>
              {shipping.map((a) => (
                <button
                  key={a.id}
                  className={cn(styles.addrOption, a.id === selectedId && styles.addrOptionOn)}
                  onClick={() => {
                    setSelectedId(a.id);
                    setChangingShip(false);
                  }}
                >
                  <Radio checked={a.id === selectedId} />
                  <div>
                    <div className={styles.addrName}>
                      {a.label || a.contactName}
                      {a.isDefault && <span className={styles.defaultTag}>Default</span>}
                    </div>
                    <div className={styles.addrLine}>{fmtAddr(a)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Billing address ── */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardTitle}>Billing address</div>
            <div className={styles.billingToggle}>
              <span className={styles.billingToggleLabel}>Same as shipping</span>
              <Toggle on={billingSame} onClick={() => setBillingSame((v) => !v)} />
            </div>
          </div>

          {billingSame ? (
            <div className={styles.muted}>
              <Check size={14} /> Billing address is the same as your delivery address.
            </div>
          ) : billingAddr ? (
            <div className={styles.address}>
              <MapPin size={18} />
              <div>
                <div className={styles.addrName}>{billingAddr.contactName} · {billingAddr.contactPhone}</div>
                <div className={styles.addrLine}>{fmtAddr(billingAddr)}</div>
              </div>
              <button className={styles.linkBtn} onClick={() => setModal({ address: billingAddr, billing: true })}>
                <Pencil size={13} /> Edit
              </button>
            </div>
          ) : (
            <button className={styles.addBtn} onClick={() => setModal({ address: null, billing: true })}>
              <Plus size={15} /> Add billing address
            </button>
          )}
        </section>

        {/* ── Payment ── */}
        <section className={styles.card}>
          <div className={styles.cardTitle}>Payment</div>
          <div className={styles.payNote}>
            <ShieldCheck size={18} />
            <div>
              <div className={styles.payNoteTitle}>Secure payment via Razorpay</div>
              <div className={styles.payNoteSub}>
                Pay with UPI, credit/debit card, net banking, or wallets. You'll choose how to pay in the next step.
              </div>
            </div>
          </div>
        </section>
      </div>

      <aside className={styles.summary}>
        <div className={styles.summaryTitle}>Order summary</div>
        <div className={styles.sumRow}>
          <span>Subtotal ({cartCount} items)</span>
          <span className={styles.tabular}>{inr(subtotal)}</span>
        </div>
        {t.exhibition > 0 && qrDiscount && (
          <div className={styles.sumRow}>
            <span className={styles.discount}>
              Exhibition discount ({qrDiscount.percent}%{qrDiscount.categoryName ? ` · ${qrDiscount.categoryName}` : ''})
            </span>
            <span className={styles.discount}>−{inr(t.exhibition)}</span>
          </div>
        )}
        {t.discount > 0 && (
          <div className={styles.sumRow}>
            <span className={styles.discount}>Coupon discount</span>
            <span className={styles.discount}>−{inr(t.discount)}</span>
          </div>
        )}
        <div className={styles.divider} />
        <div className={styles.total}>
          <span>Total</span>
          <span className={styles.tabular}>{inr(t.total)}</span>
        </div>

        <Button size="lg" block onClick={submit} disabled={busy || !selected || !billingReady} style={{ marginTop: 16 }}>
          {busy ? 'Processing…' : `Pay ${inr(t.total)}`}
        </Button>
      </aside>

      {modal && (
        <AddressModal
          address={modal.address}
          billing={modal.billing}
          onClose={() => setModal(null)}
          onSaved={(saved) => {
            setModal(null);
            if (saved.isBilling) {
              setBillingSame(false);
              void loadAddresses();
            } else {
              void loadAddresses(saved.id);
            }
          }}
        />
      )}
    </div>
  );
}
