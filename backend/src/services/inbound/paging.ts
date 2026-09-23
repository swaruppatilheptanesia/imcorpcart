// Page cap shared by inbound adapters that paginate a vendor API.
//
// The cap is OPT-IN: without `VENDOR_IMPORT_MAX_PAGES` every environment pulls the
// whole catalog (adapters self-terminate at the API's real last page; the ceiling
// below only guards against a misbehaving API that never stops paging). Set the env
// var for a deliberately bounded trial — e.g. VENDOR_IMPORT_MAX_PAGES=2.
//
// This used to be 8 pages outside production, which silently imported a partial
// catalog (Hubble: 400 of 522 brands) that looked like a complete one. A truncated
// run is also unsafe to prune against, hence `isPageCapExplicit` below.
const SAFETY_MAX_PAGES = 1000;

function pageCapOverride(): number | null {
  const override = Number(process.env.VENDOR_IMPORT_MAX_PAGES);
  return Number.isFinite(override) && override > 0 ? Math.trunc(override) : null;
}

export function resolveMaxPages(): number {
  return pageCapOverride() ?? SAFETY_MAX_PAGES;
}

/**
 * True when the operator pinned a page cap, so this run may be a deliberately
 * truncated slice of the vendor's catalog. Callers must not treat such a run as a
 * complete picture of the feed (see the prune guard in vendor-source.service).
 */
export function isPageCapExplicit(): boolean {
  return pageCapOverride() !== null;
}
