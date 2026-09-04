// Contract for a per-vendor inbound adapter. An adapter's only job is to call
// the vendor's API/feed and yield NormalizedRows; the shared import service
// (import.service.ts) handles pricing, category upsert, the Product/offer write,
// DRAFT status, provenance and the run log. New vendor = one adapter file.

export interface NormalizedRow {
  externalRef: string; // the vendor's own SKU/id — namespaced into our sku for dedup
  name: string;
  brand?: string | null;
  category: string; // vendor category name (free text; created/mapped on import)
  subCategory?: string | null;
  mrp: number; // vendor MRP — our eppPrice is derived via the source discount %
  description?: string | null;
  images?: string[];
  specRows?: { k: string; v: string }[];
  familyKey?: string | null;
  optionColor?: string | null;
  optionVariant?: string | null;
  hsnCode?: string | null;
  gstPercent?: number | null;
  warrantyText?: string | null;
  termsText?: string | null;
  stock?: number | null;
}

// Runtime context handed to an adapter (secrets already decrypted).
export interface VendorSourceContext {
  id: string;
  slug: string;
  baseUrl: string | null;
  apiKey: string | null;
  config: Record<string, unknown> | null;
}

export interface VendorAdapter {
  key: string; // registry key stored on VendorSource.adapter (== the source slug)
  label: string; // human name — becomes the auto-provisioned source's display name
  // Provisioning defaults applied when the source is auto-created from this
  // adapter (dev-configured integration). Admin edits are never overwritten.
  defaults?: {
    baseUrl?: string;
    discountPct?: number;
    config?: Record<string, unknown>;
  };
  fetchRows(ctx: VendorSourceContext): AsyncIterable<NormalizedRow>;
}
