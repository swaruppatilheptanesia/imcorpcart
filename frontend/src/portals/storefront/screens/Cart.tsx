import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gift, X, Check, ShoppingBag, Landmark, AlertTriangle } from 'lucide-react';
import { Button, EmptyState, Spinner } from '@/components';
import { cn } from '@/lib/cn';
import { inr } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { getSeppQuote } from '@/data/shop-api';
import { useStore } from '../store-context';
import { computeDiscount } from '../coupon';
import { QtyStepper } from '../components/QtyStepper';
import styles from './Cart.module.css';

export function Cart() {
  const navigate = useNavigate();
  const {
    ready, cart, setLineQty, removeLine, subtotal, appliedCoupon, couponError, applyCoupon, removeCoupon, qrDiscount,
    checkoutEnabled, viewOnly, purchaseMode, sepp,
  } = useStore();
  const [code, setCode] = useState('');
  const seppMode = purchaseMode === 'SEPP';

  // Smart EPP: the server prices the cart on the lease calculator (single source
  // of truth) and reports blockers — no phone, over the limit, no office address.
  const cartKey = cart.map((l) => `${l.itemId}:${l.qty}`).join('|');
  const seppQ = useAsync(
    () => (seppMode && cart.length ? getSeppQuote() : Promise.resolve(null)),
    [seppMode, cartKey],
  );
  const quote = seppQ.data ?? null;
  const emiFor = (itemId: string) => quote?.lines.find((l) => l.itemId === itemId) ?? null;

  if (ready && cart.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingBag size={24} />}
        title="Your cart is empty"
        body="Browse the store and add products to get started."
        action={{ label: 'Go to store', onClick: () => navigate('/shop/home') }}
      />
    );
  }

  // Exhibition (QR) discount base: whole cart, or just the campaign category's
  // items for a category-scoped campaign.
  const qrBase = qrDiscount?.categorySlug
    ? cart.filter((l) => l.group === qrDiscount.categorySlug).reduce((s, l) => s + l.price * l.qty, 0)
    : subtotal;
  const discount = computeDiscount(appliedCoupon, subtotal);
  const exhibition = qrDiscount ? Math.round((qrBase * qrDiscount.percent) / 100) : 0;
  const payable = subtotal - exhibition - discount;

  return (
    <div className={styles.layout}>
      <div className={styles.lines}>
        {cart.map((line) => {
          const shade = line.shades.find((sh) => sh.name === line.shade);
          const g1 = shade?.g1 ?? line.g1;
          const g2 = shade?.g2 ?? line.g2;
          const openProduct = () => navigate(`/shop/product/${line.productId}`);
          const emi = seppMode ? emiFor(line.itemId) : null;
          // Amazon-style spec highlights (first few spec values; drop packaging).
          const specLine = (line.specs ?? [])
            .filter((s) => s.k.toLowerCase() !== 'in the box')
            .slice(0, 4)
            .map((s) => s.v)
            .join('  ·  ');
          return (
            <div key={line.itemId} className={styles.line}>
              <button className={styles.thumb} onClick={openProduct} aria-label={`View ${line.name}`}>
                {line.image ? (
                  <img className={styles.img} src={line.image} alt={line.name} />
                ) : (
                  <span className={styles.device} style={{ background: `linear-gradient(155deg, ${g1}, ${g2})` }} />
                )}
              </button>
              <div className={styles.info}>
                <button className={styles.name} onClick={openProduct}>{line.name}</button>
                <div className={styles.brand}>{line.brand}</div>
                <div className={cn(styles.stock, line.stock <= 0 && styles.oos)}>
                  {line.stock <= 0 ? 'Out of stock' : line.stock <= 5 ? `Only ${line.stock} left in stock` : 'In stock'}
                </div>
                {specLine && <div className={styles.specs}>{specLine}</div>}
                {line.desc && <div className={styles.desc}>{line.desc}</div>}
                {line.freebie.enabled && (
                  <div className={styles.freebieChip}>
                    <Gift size={11} /> {line.freebie.description}
                  </div>
                )}
                {line.voucher || line.denomination != null ? (
                  <div className={styles.shade}>Amount: {inr(line.denomination ?? Number(line.shade))}</div>
                ) : line.shade ? (
                  <div className={styles.shade}>
                    <span className={styles.shadeDot} style={{ background: `linear-gradient(155deg, ${g1}, ${g2})` }} />
                    Colour: {line.shade}
                  </div>
                ) : null}
                <div className={styles.lineControls}>
                  <QtyStepper value={line.qty} onChange={(v) => void setLineQty(line.itemId, v)} />
                  <button className={styles.remove} onClick={() => void removeLine(line.itemId)}>
                    Remove
                  </button>
                </div>
              </div>
              {seppMode ? (
                <div className={styles.linePrice}>
                  {emi ? (
                    <>
                      {inr(emi.lineMonthlyEmi)}
                      <span className={styles.perMo}>/mo</span>
                    </>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </div>
              ) : (
                <div className={styles.linePrice}>{inr(line.price * line.qty)}</div>
              )}
            </div>
          );
        })}
        {!ready && (
          <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}>
            <Spinner size={24} />
          </div>
        )}
      </div>

      {seppMode ? (
        /* ── Smart EPP summary ── */
        <aside className={styles.summary}>
          <div className={styles.summaryTitle}>
            <Landmark size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Smart EPP summary
          </div>

          {seppQ.state === 'loading' && (
            <div style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
              <Spinner size={20} />
            </div>
          )}
          {seppQ.state === 'error' && (
            <div className={styles.seppIssue}>
              <AlertTriangle size={14} /> {seppQ.error ?? "Couldn't price this cart on Smart EPP."}
            </div>
          )}

          {quote && (
            <>
              <div className={styles.sumRow}>
                <span>Monthly EMI (incl. GST)</span>
                <span className={styles.tabular}>{inr(quote.quote.monthlyRental)}</span>
              </div>
              <div className={styles.sumRow}>
                <span>Pre-tax salary deduction / month</span>
                <span className={styles.tabular}>{inr(quote.quote.preTaxDeduction)}</span>
              </div>
              <div className={styles.sumRow}>
                <span>Net impact after tax saving / month</span>
                <span className={styles.tabular}>{inr(quote.quote.postTaxDeduction)}</span>
              </div>
              <div className={styles.sumRow}>
                <span>Tenure</span>
                <span className={styles.muted}>{quote.quote.tenureMonths} months</span>
              </div>
              <div className={styles.divider} />
              <div className={styles.sumRow}>
                <span>Effective purchase (pre-tax × tenure)</span>
                <span className={styles.tabular}>{inr(quote.quote.totalPreTaxDeduction)}</span>
              </div>
              <div className={styles.sumRow}>
                <span className={styles.muted}>Your available limit</span>
                <span className={cn(styles.tabular, !quote.withinLimit && styles.over)}>{inr(quote.available)}</span>
              </div>
              <div className={styles.sumRow}>
                <span>Effective cost to you</span>
                <span className={styles.tabular}>{inr(quote.quote.effectivePrice)}</span>
              </div>
              <div className={styles.divider} />
              <div className={styles.total}>
                <span>Pay now (advance)</span>
                <span className={styles.tabular}>{inr(quote.advance)}</span>
              </div>
              <div className={styles.seppNote}>
                {quote.advance > 0
                  ? `One-time advance levied by ${quote.leasingCompany}. Refunded if your request isn't approved.`
                  : `No advance — ${quote.leasingCompany} collects the lease through your salary.`}
              </div>

              {quote.issues.map((msg) => (
                <div key={msg} className={styles.seppIssue}>
                  <AlertTriangle size={14} /> {msg}
                </div>
              ))}
            </>
          )}

          {checkoutEnabled ? (
            <Button
              size="lg"
              block
              onClick={() => navigate('/shop/checkout')}
              style={{ marginTop: 16 }}
              disabled={!quote || !quote.canSubmit}
            >
              Continue to Smart EPP request
            </Button>
          ) : (
            <>
              <Button size="lg" block disabled style={{ marginTop: 16 }}>
                {viewOnly ? 'Requests disabled (demo)' : 'Smart EPP — coming soon'}
              </Button>
              <p className={styles.checkoutSoon}>
                {viewOnly
                  ? 'This is a view-only demo account. Browse, cart and wishlist are fully functional; requests are disabled.'
                  : "Smart EPP requests are launching shortly. You can build your cart now — we'll email you when they open."}
              </p>
            </>
          )}
          <p className={styles.checkoutSoon}>
            Approved by your HR, then by {sepp?.leasingCompany ?? 'the leasing company'}. Delivered to your office.
          </p>
        </aside>
      ) : (
        /* ── EPP order summary ── */
        <aside className={styles.summary}>
          <div className={styles.summaryTitle}>Order summary</div>

          <div className={styles.sumRow}>
            <span>Delivery</span>
            <span className={styles.free}>Free</span>
          </div>

          <div className={styles.couponBlock}>
            {appliedCoupon ? (
              <div className={styles.applied}>
                <Check size={15} />
                <span className={styles.appliedCode}>{appliedCoupon.code}</span>
                <span className={styles.appliedLabel}>applied</span>
                <button className={styles.removeCoupon} onClick={removeCoupon} aria-label="Remove coupon">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <div className={styles.couponInput}>
                  <input
                    className={styles.couponField}
                    placeholder="Add coupon code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                  />
                  <Button size="sm" onClick={() => void applyCoupon(code)}>
                    Apply
                  </Button>
                </div>
                {couponError && <div className={styles.couponError}>{couponError}</div>}
              </>
            )}
          </div>

          <div className={styles.sumRow}>
            <span>Subtotal</span>
            <span className={styles.tabular}>{inr(subtotal)}</span>
          </div>
          {exhibition > 0 && qrDiscount && (
            <div className={styles.sumRow}>
              <span className={styles.discountLabel}>
                Exhibition discount ({qrDiscount.percent}%{qrDiscount.categoryName ? ` · ${qrDiscount.categoryName}` : ''})
              </span>
              <span className={styles.discountVal}>−{inr(exhibition)}</span>
            </div>
          )}
          {discount > 0 && (
            <div className={styles.sumRow}>
              <span className={styles.discountLabel}>Coupon discount</span>
              <span className={styles.discountVal}>−{inr(discount)}</span>
            </div>
          )}
          <div className={styles.sumRow}>
            <span>Payment charges</span>
            <span className={styles.muted}>At checkout</span>
          </div>
          <div className={styles.divider} />
          <div className={styles.total}>
            <span>Total</span>
            <span className={styles.tabular}>{inr(payable)}</span>
          </div>

          {checkoutEnabled ? (
            <Button size="lg" block onClick={() => navigate('/shop/checkout')} style={{ marginTop: 16 }} disabled={cart.length === 0}>
              Proceed to checkout
            </Button>
          ) : (
            <>
              <Button size="lg" block disabled style={{ marginTop: 16 }}>
                {viewOnly ? 'Checkout disabled (demo)' : 'Checkout — coming soon'}
              </Button>
              <p className={styles.checkoutSoon}>
                {viewOnly
                  ? 'This is a view-only demo account. Browse, cart and wishlist are fully functional; purchase and checkout are disabled.'
                  : "Online checkout is launching shortly. You can build your cart and wishlist now — we'll email you when ordering opens."}
              </p>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
