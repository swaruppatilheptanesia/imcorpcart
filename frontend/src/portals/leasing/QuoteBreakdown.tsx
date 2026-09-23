import type { SeppQuote } from '@/data/sepp-types';
import { inr } from '@/lib/format';

export function Kv({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '4px 0',
        borderBottom: '1px solid var(--hair)',
        fontWeight: strong ? 700 : 400,
      }}
    >
      <span style={{ color: strong ? 'var(--text)' : 'var(--text2)' }}>{k}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}

/** The lease illustration for one quote — the same figures the employee saw on
 *  the storefront calculator card, laid out for a financing desk. */
export function QuoteBreakdown({ quote, advance, compact }: { quote: SeppQuote; advance?: number; compact?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: '4px 24px', fontSize: 13 }}>
      <Kv k="Asset cost (incl. GST)" v={inr(quote.assetCost)} strong />
      <Kv k="Tenure" v={`${quote.tenureMonths} months`} />
      <Kv k="Monthly rental (incl. GST)" v={inr(quote.monthlyRental)} strong />
      <Kv k="GST input credit / month" v={inr(quote.gstInput)} />
      {quote.adldMonthly > 0 && <Kv k="ADLD insurance / month" v={inr(quote.adldMonthly)} />}
      <Kv k="Pre-tax salary deduction / month" v={inr(quote.preTaxDeduction)} />
      <Kv k="Income-tax shelter / month" v={inr(quote.itShelter)} />
      <Kv k="Net after tax / month" v={inr(quote.postTaxDeduction)} />
      <Kv k="Total lease rentals" v={inr(quote.totalLease)} />
      <Kv k={`Buy-back at end of lease`} v={inr(quote.repurchase)} />
      <Kv k="PV discount on rentals" v={quote.pvLease > 0 ? `−${inr(quote.pvLease)}` : '—'} />
      <Kv k="PV discount on buy-back" v={quote.pvRepurchase > 0 ? `−${inr(quote.pvRepurchase)}` : '—'} />
      <Kv k="Effective cost to employee" v={`${inr(quote.effectivePrice)} (${quote.effectivePct}%)`} strong />
      {advance !== undefined && <Kv k="Advance collected at request" v={advance > 0 ? inr(advance) : 'None'} />}
    </div>
  );
}
