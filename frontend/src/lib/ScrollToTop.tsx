import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Reset the window scroll on navigation.
 *
 * Without this a route change keeps the previous page's scroll offset, so opening
 * a product from halfway down the catalogue lands part-way down the detail page.
 *
 * Two deliberate exceptions:
 * - `POP` (browser back/forward) is left alone, so returning to a list keeps the
 *   reader where they were rather than throwing them to the top.
 * - Only `pathname` is watched, not `search` — the storefront writes filters and
 *   subcategories into the query string, and jumping to the top on every facet
 *   tick would fight the user.
 * - A caller can opt out per-navigation with `state: { keepScroll: true }`, used
 *   by the product page's colour/storage selector: it routes to a sibling SKU but
 *   is really a change within the page the reader is already partway down.
 */
export function ScrollToTop() {
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  const keepScroll = Boolean((state as { keepScroll?: boolean } | null)?.keepScroll);

  useEffect(() => {
    if (navigationType === 'POP' || keepScroll) return;
    // `instant` because this is a page change, not an in-page jump: a smooth
    // scroll here animates content the reader has already moved past, and is
    // visible as a lurch on a long catalogue page.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, navigationType, keepScroll]);

  return null;
}
