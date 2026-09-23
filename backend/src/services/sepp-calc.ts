// ─────────────────────────────────────────────────────────────────────────────
// Smart EPP (operating-lease) calculator — the SINGLE source of truth for every
// EMI / effective-price figure shown on the storefront, stored on a request, and
// used by HR / Leasing approvals. Pure functions, no I/O.
//
// v1 reproduces the client's "Financial Illustration (Enterprise EPP Working)"
// sheet exactly (Galaxy S24+: asset ₹98,900 incl. GST, PTPM 89.50, 12 months,
// 30% slab, 2% repurchase, PV 5.21% / 9.1% → ₹8,852/mo, effective ₹61,525).
// The client will supply final formulas later — swap them in HERE only.
// ─────────────────────────────────────────────────────────────────────────────

export type AdvanceFeeType = 'FIXED' | 'PERCENT';

// Lease parameters: leasing-company-set (ptpm / tenure / repurchase / PV /
// advance) + company-set (ADLD insurance, income-tax slab) + product GST.
export interface SeppParams {
  gstPct: number; // product GST % (assetCost is GST-inclusive)
  ptpm: number; // rental per ₹1000 of asset per month (incl. GST)
  tenureMonths: number;
  incomeTaxPct: number; // employee's slab, for the tax-shelter illustration
  repurchasePct: number; // end-of-lease buyback, % of asset cost
  pvDiscountLeasePct: number; // PV discount on the monthly streams (rent / GST credit / IT shelter)
  pvDiscountRepurchasePct: number; // PV discount on the end-of-term repurchase price
  adldPct: number; // annual ADLD + theft insurance, % of asset cost (0 = none)
  advanceFeeType: AdvanceFeeType;
  advanceFeeValue: number; // ₹ (FIXED) or % of asset cost (PERCENT)
}

export const DEFAULT_SEPP_PARAMS: SeppParams = {
  gstPct: 18,
  ptpm: 89.5,
  tenureMonths: 12,
  incomeTaxPct: 30,
  repurchasePct: 2,
  pvDiscountLeasePct: 0,
  pvDiscountRepurchasePct: 0,
  adldPct: 0,
  advanceFeeType: 'FIXED',
  advanceFeeValue: 0,
};

// Every figure is a whole rupee (rounded once, at the end of each line item).
export interface SeppQuote {
  assetCost: number; // incl. GST
  baseValue: number; // ex-GST
  gstOnAsset: number;
  tenureMonths: number;
  // Monthly
  monthlyRental: number; // incl. GST — what the corporate pays the leasing co.
  gstInput: number; // GST input credit the corporate claims per month
  adldMonthly: number; // insurance add-on per month (0 when unset)
  preTaxDeduction: number; // salary deduction before tax (rental ex-GST + ADLD)
  itShelter: number; // income-tax saved per month at the slab
  postTaxDeduction: number; // net monthly salary impact
  // Over the tenure
  totalLease: number; // monthlyRental × tenure
  totalPreTaxDeduction: number; // preTaxDeduction × tenure — the purchase-limit basis
  totalItShelter: number;
  totalGstInput: number;
  // End of lease
  repurchase: number; // buyback price incl. GST
  pvLease: number; // PV discount on the monthly streams (illustrative)
  pvRepurchase: number; // PV discount on the repurchase price
  effectivePrice: number; // what the device really costs the employee
  effectivePct: number; // effectivePrice as % of asset cost (1 decimal)
}

const r0 = (n: number) => Math.round(n);

export function computeSeppQuote(assetCost: number, input: Partial<SeppParams> = {}): SeppQuote {
  const p: SeppParams = { ...DEFAULT_SEPP_PARAMS, ...input };
  const g = p.gstPct / 100;
  const t = Math.max(1, Math.round(p.tenureMonths));

  const baseValue = assetCost / (1 + g);
  const gstOnAsset = assetCost - baseValue;

  // Unrounded monthly figures — rounding each line independently is what makes
  // the sheet's 8,852 / 1,350 / 7,501 / 2,250 / 5,251 line up.
  const monthlyRental = (assetCost / 1000) * p.ptpm;
  const rentalExGst = monthlyRental / (1 + g);
  const gstInput = monthlyRental - rentalExGst;
  const adldMonthly = (assetCost * (p.adldPct / 100)) / 12;
  const preTaxDeduction = rentalExGst + adldMonthly;
  const itShelter = preTaxDeduction * (p.incomeTaxPct / 100);
  const postTaxDeduction = preTaxDeduction - itShelter;

  const totalLease = monthlyRental * t;
  const totalPreTaxDeduction = preTaxDeduction * t;
  const totalItShelter = itShelter * t;
  const totalGstInput = gstInput * t;

  const repurchase = assetCost * (p.repurchasePct / 100);
  const pvF = 1 - p.pvDiscountLeasePct / 100; // applied to every monthly stream
  const pvR = 1 - p.pvDiscountRepurchasePct / 100;
  const pvLease = totalLease * (1 - pvF);
  const pvRepurchase = repurchase * (1 - pvR);

  // Effective cost = discounted rent − discounted tax shelter − discounted GST
  // credit + discounted buyback. (Sheet: 106,219 − 5,537 − 25,597 − 15,358 +
  // 1,978 − 180 = 61,525.)
  const effectivePrice =
    totalLease * pvF - totalItShelter * pvF - totalGstInput * pvF + repurchase * pvR;

  return {
    assetCost: r0(assetCost),
    baseValue: r0(baseValue),
    gstOnAsset: r0(gstOnAsset),
    tenureMonths: t,
    monthlyRental: r0(monthlyRental),
    gstInput: r0(gstInput),
    adldMonthly: r0(adldMonthly),
    preTaxDeduction: r0(preTaxDeduction),
    itShelter: r0(itShelter),
    postTaxDeduction: r0(postTaxDeduction),
    totalLease: r0(totalLease),
    totalPreTaxDeduction: r0(totalPreTaxDeduction),
    totalItShelter: r0(totalItShelter),
    totalGstInput: r0(totalGstInput),
    repurchase: r0(repurchase),
    pvLease: r0(pvLease),
    pvRepurchase: r0(pvRepurchase),
    effectivePrice: r0(effectivePrice),
    effectivePct: assetCost > 0 ? Math.round((effectivePrice / assetCost) * 1000) / 10 : 0,
  };
}

// Advance the employee pays at submission (levied by the leasing company) —
// a flat amount per request, or a % of the request's total asset cost.
export function computeAdvance(totalAssetCost: number, p: Pick<SeppParams, 'advanceFeeType' | 'advanceFeeValue'>): number {
  if (p.advanceFeeValue <= 0) return 0;
  return r0(p.advanceFeeType === 'PERCENT' ? totalAssetCost * (p.advanceFeeValue / 100) : p.advanceFeeValue);
}

// Sum quotes across cart lines (each already scaled by quantity). Tenure is the
// shared lease tenure; the ratio fields are recomputed from the sums.
export function sumSeppQuotes(quotes: SeppQuote[]): SeppQuote {
  const tenureMonths = quotes[0]?.tenureMonths ?? DEFAULT_SEPP_PARAMS.tenureMonths;
  const keys: (keyof SeppQuote)[] = [
    'assetCost', 'baseValue', 'gstOnAsset', 'monthlyRental', 'gstInput', 'adldMonthly', 'preTaxDeduction',
    'itShelter', 'postTaxDeduction', 'totalLease', 'totalPreTaxDeduction', 'totalItShelter', 'totalGstInput',
    'repurchase', 'pvLease', 'pvRepurchase', 'effectivePrice',
  ];
  const out = { tenureMonths, effectivePct: 0 } as SeppQuote;
  for (const k of keys) out[k] = quotes.reduce((s, q) => s + q[k], 0);
  out.effectivePct = out.assetCost > 0 ? Math.round((out.effectivePrice / out.assetCost) * 1000) / 10 : 0;
  return out;
}

export function scaleSeppQuote(q: SeppQuote, qty: number): SeppQuote {
  if (qty === 1) return q;
  return sumSeppQuotes(Array.from({ length: qty }, () => q));
}
