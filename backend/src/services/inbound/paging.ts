import { env } from '../../config/env';

// Environment-driven page cap shared by inbound adapters that paginate a vendor
// API: dev is limited (a bounded trial), production is unlimited (pulls the whole
// catalog — adapters self-terminate at the API's real last page; the ceiling only
// guards against a misbehaving API). `VENDOR_IMPORT_MAX_PAGES` overrides both
// (e.g. a full trial in dev without flipping NODE_ENV).
const DEV_MAX_PAGES = 8;
const SAFETY_MAX_PAGES = 1000;

export function resolveMaxPages(): number {
  const override = Number(process.env.VENDOR_IMPORT_MAX_PAGES);
  if (Number.isFinite(override) && override > 0) return Math.trunc(override);
  return env.isProd ? SAFETY_MAX_PAGES : DEV_MAX_PAGES;
}
