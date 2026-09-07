import type { VendorAdapter, VendorSourceContext, NormalizedRow } from '../types';
import { resolveMaxPages } from '../paging';
import { hubbleConfigured, hubbleRequest } from '../../../config/hubble';

// Adapter for Hubble (myhubble.money) gift-card vouchers — CATALOG ONLY.
// Lists every ACTIVE reward brand as one first-party product under a "Vouchers"
// category (one product per brand; denominations ride in specs, and the actual
// denomination is chosen at purchase in the admin-mediated fulfilment phase).
// Auth + paging live in config/hubble.ts. We never call Hubble's order/wallet APIs.
//
// GAPS: price shown is the "from" (min denomination) — the real amount is picked at
// checkout (Part B); stock is notional (digital = unlimited); no HSN/GST/warranty.

const CATEGORY = 'Vouchers';
const PAGE_LIMIT = 50;
const DIGITAL_STOCK = 999999; // digital → effectively unlimited (keeps the offer in-stock/visible)

interface HubbleBrand {
  id: string;
  status?: string;
  title?: string;
  brandDescription?: string | null;
  category?: string[];
  denominationType?: string;
  amountRestrictions?: {
    minVoucherAmount?: number;
    maxVoucherAmount?: number;
    denominations?: number[] | null;
  } | null;
  cardType?: string;
  redemptionType?: string;
  iconImageUrl?: string | null;
  thumbnailUrl?: string | null;
  logoUrl?: string | null;
  voucherExpiryInMonths?: number | null;
  termsAndConditions?: string[];
  parentBrand?: { name?: string } | null;
}

interface HubbleList {
  nextCursor?: { pageNo: number; limit: number } | null;
  data?: HubbleBrand[];
}

function startingPrice(b: HubbleBrand): number {
  const denoms = b.amountRestrictions?.denominations;
  if (Array.isArray(denoms) && denoms.length) {
    const positive = denoms.filter((d) => Number(d) > 0);
    if (positive.length) return Math.min(...positive);
  }
  return Number(b.amountRestrictions?.minVoucherAmount) || 0;
}

function denominationLabel(b: HubbleBrand): string {
  const denoms = b.amountRestrictions?.denominations;
  if (Array.isArray(denoms) && denoms.length) return denoms.map((d) => `₹${d}`).join(', ');
  const min = b.amountRestrictions?.minVoucherAmount;
  const max = b.amountRestrictions?.maxVoucherAmount;
  if (min && max) return `₹${min}–₹${max} (custom amount)`;
  return '—';
}

// Structured denomination options → Product.specs.voucher, so the storefront can
// render a real picker (fixed chips or a bounded custom-amount input) and the
// backend can validate the buyer's chosen amount at add-to-cart.
function voucherSpec(b: HubbleBrand): {
  denominations: number[];
  min: number | null;
  max: number | null;
  type: string | null;
} {
  const raw = b.amountRestrictions?.denominations;
  const denominations = Array.isArray(raw) ? raw.map((d) => Number(d)).filter((d) => d > 0) : [];
  return {
    denominations,
    min: Number(b.amountRestrictions?.minVoucherAmount) || null,
    max: Number(b.amountRestrictions?.maxVoucherAmount) || null,
    type: b.denominationType ?? null, // FIXED | FLEXIBLE
  };
}

export const hubbleAdapter: VendorAdapter = {
  key: 'hubble',
  label: 'Hubble (gift-card vouchers)',
  defaults: { config: {} },
  async *fetchRows(_ctx: VendorSourceContext): AsyncIterable<NormalizedRow> {
    if (!hubbleConfigured()) {
      throw new Error('Hubble is not configured — set HUBBLE_CLIENT_ID / HUBBLE_CLIENT_SECRET in .env');
    }
    const maxPages = resolveMaxPages();

    for (let page = 1; page <= maxPages; page++) {
      const resp = await hubbleRequest<HubbleList>('GET', '/v1/partners/products', {
        query: { pageNo: page, limit: PAGE_LIMIT },
      });
      const items = Array.isArray(resp?.data) ? resp.data : [];
      if (items.length === 0) break;

      for (const b of items) {
        const id = String(b?.id ?? '').trim();
        if (!id) continue;
        if (String(b.status ?? '').toUpperCase() !== 'ACTIVE') continue; // only live brands

        const price = startingPrice(b);
        if (!(price > 0)) continue; // importer requires mrp > 0

        const image = b.iconImageUrl || b.thumbnailUrl || b.logoUrl || null;
        const specRows = [
          { k: 'Denominations', v: denominationLabel(b) },
          ...(b.cardType ? [{ k: 'Card type', v: b.cardType.replace(/_/g, ' ') }] : []),
          ...(b.redemptionType ? [{ k: 'Redemption', v: b.redemptionType.replace(/_/g, ' ') }] : []),
          ...(b.voucherExpiryInMonths ? [{ k: 'Validity', v: `${b.voucherExpiryInMonths} months` }] : []),
        ];

        yield {
          externalRef: id, // Hubble brand/product id → sku = hubble-<id>
          name: b.title?.trim() || `Voucher ${id}`,
          brand: b.parentBrand?.name?.trim() || b.title?.trim() || null,
          category: CATEGORY, // → creates/uses the "Vouchers" category
          subCategory: b.category?.[0] ?? null, // Hubble's own category (e.g. FOOD)
          mrp: price, // "from" price = min denomination
          mop: price,
          description: b.brandDescription?.trim() || (b.termsAndConditions ?? []).join(' ') || null,
          images: image ? [image] : [],
          specRows,
          stock: DIGITAL_STOCK,
          familyKey: null,
          optionColor: null,
          optionVariant: null,
          hsnCode: null,
          gstPercent: null,
          warrantyText: null,
          termsText: (b.termsAndConditions ?? []).join('\n') || null,
          specsExtra: { voucher: voucherSpec(b) }, // structured denominations for the checkout picker
        };
      }

      if (!resp?.nextCursor) break; // no more pages
      if (items.length < PAGE_LIMIT) break;
    }
  },
};
