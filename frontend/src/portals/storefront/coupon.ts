/** Coupon + checkout math — the single source of truth, replicated exactly from
 *  the design handoff. Cart and Checkout both consume this; never re-derive. */

import type { StoreCoupon, StoreCategory } from '@/data/store-types';

// Discount for an applied coupon at a given subtotal. Assumes qualification
// (min + scope) already checked by validateCoupon.
export function computeDiscount(coupon: StoreCoupon | null, subtotal: number): number {
  if (!coupon) return 0;
  if (subtotal < (coupon.min ?? 0)) return 0;
  let d =
    coupon.type === 'pct'
      ? Math.min(Math.round((subtotal * coupon.val) / 100), coupon.cap ?? Infinity)
      : coupon.val;
  return Math.min(d, subtotal); // never exceed subtotal
}

export interface Totals {
  exhibition: number;
  discount: number;
  walletApplied: number;
  payable: number;
  surcharge: number;
  gst: number;
  total: number;
}

// Round surcharge and GST independently (not once at the end). The exhibition
// (QR campaign) percentage reduces subtotal first, before the coupon — this
// mirrors the server's placeOrder math exactly. `qrBase` is the value the
// exhibition % applies to (the whole subtotal, or just the campaign category's
// items for a category-scoped campaign); defaults to the full subtotal.
export function computeTotals(
  subtotal: number,
  coupon: StoreCoupon | null,
  methodPct: number,
  qrPct = 0,
  qrBase = subtotal,
  gstPct = 18,
  walletBalance = 0, // available wallet balance to redeem (0 = don't redeem)
): Totals {
  const exhibition = Math.round((qrBase * qrPct) / 100);
  const discount = computeDiscount(coupon, subtotal);
  const payableBeforeWallet = subtotal - exhibition - discount;
  // Wallet redeems as much as possible, capped at the payable (never negative).
  const walletApplied = Math.min(Math.max(0, walletBalance), Math.max(0, payableBeforeWallet));
  const payable = payableBeforeWallet - walletApplied;
  // Surcharge applies only to the Razorpay-paid remainder (not wallet-paid money).
  const surcharge = Math.round((payable * methodPct) / 100);
  const gst = Math.round((surcharge * gstPct) / 100);
  return { exhibition, discount, walletApplied, payable, surcharge, gst, total: payable + surcharge + gst };
}

// EMI for the Smart EPP option (beyond-handoff): flat rate over the tenure.
export function computeEmi(payable: number, months: number, rate: number): number {
  return Math.round((payable * (1 + rate)) / months);
}

export type CouponResult =
  | { ok: true; coupon: StoreCoupon }
  | { ok: false; error: string };

// Validate a typed code against the catalog scope + minimum.
export function validateCoupon(
  code: string,
  coupons: StoreCoupon[],
  subtotal: number,
  cartCategories: StoreCategory[],
): CouponResult {
  const c = coupons.find((x) => x.code === code.trim().toUpperCase());
  if (!c) return { ok: false, error: 'Invalid coupon code' };
  if (c.scope !== 'all' && !cartCategories.includes(c.scope)) {
    return { ok: false, error: `This code only applies to ${c.scope}` };
  }
  if (subtotal < (c.min ?? 0)) {
    return { ok: false, error: `Add ₹${((c.min ?? 0) - subtotal).toLocaleString('en-IN')}+ to use this code` };
  }
  return { ok: true, coupon: c };
}
