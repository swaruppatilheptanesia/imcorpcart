import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import * as shop from '@/data/shop-api';
import type { CartLineView, PlacedOrder, RazorpayHandoff, ShopNotificationApi } from '@/data/shop-api';
import type { FilterState, SortKey, StoreCoupon, StoreProduct } from '@/data/store-types';
import { DEFAULT_FILTERS, PRICE_FLOOR, PRICE_CEIL } from '@/data/store-types';
import { loadCatalog, coupons as catalogCoupons, priceCeil as catalogPriceCeil } from './data';

interface StoreCtxValue {
  ready: boolean;
  authed: boolean; // signed-in employee (EPP prices) vs public browsing (MOP)
  smartEppEnabled: boolean; // company has Smart EPP enabled (gates the EMI option)
  checkoutEnabled: boolean; // master switch — false hides all pay/checkout entry points
  // cart (server-backed)
  cart: CartLineView[];
  addToCart: (id: string, shade: string, qty: number) => Promise<void>;
  setLineQty: (itemId: string, qty: number) => Promise<void>;
  removeLine: (itemId: string) => Promise<void>;
  cartCount: number;
  subtotal: number;
  placeOrder: (
    couponCode?: string,
    addressId?: string,
    billingAddressId?: string,
    payment?: RazorpayHandoff,
  ) => Promise<PlacedOrder>;
  // Exhibition (QR campaign) discount the shopper is currently entitled to.
  qrDiscount: { percent: number; campaignName: string; categorySlug: string | null; categoryName: string | null } | null;
  // Alerts (derived server-side from the shopper's own order history).
  notifs: ShopNotificationApi[];
  notifsUnread: boolean;
  markNotifsSeen: () => void;
  // wishlist
  wishlist: StoreProduct[];
  toggleWishlist: (id: string) => Promise<void>;
  isWished: (id: string) => boolean;
  // coupons
  coupons: StoreCoupon[];
  appliedCoupon: StoreCoupon | null;
  couponError: string | null;
  applyCoupon: (code: string) => Promise<void>;
  removeCoupon: () => void;
  clearCouponError: () => void;
  // filters + view (client-side)
  filters: FilterState;
  setFilters: (patch: Partial<FilterState>) => void;
  clearFilters: () => void;
  activeFilterCount: number;
  priceCeil: number; // price-slider max, auto-fitted to the catalog's priciest product
  sortBy: SortKey;
  setSortBy: (s: SortKey) => void;
  grid: boolean;
  setGrid: (g: boolean) => void;
  search: string;
  setSearch: (s: string) => void;
}

const StoreCtx = createContext<StoreCtxValue | null>(null);

export function StoreProvider({ authed, children }: { authed: boolean; children: ReactNode }) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [cart, setCart] = useState<CartLineView[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [wishlist, setWishlist] = useState<StoreProduct[]>([]);
  const [coupons, setCoupons] = useState<StoreCoupon[]>([]);
  const [appliedCoupon, setAppliedCoupon] = useState<StoreCoupon | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [qrDiscount, setQrDiscount] = useState<
    { percent: number; campaignName: string; categorySlug: string | null; categoryName: string | null } | null
  >(null);
  const [smartEppEnabled, setSmartEppEnabled] = useState(false);
  // Default false so the Pay/checkout buttons never flash before the profile
  // confirms checkout is open.
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [notifs, setNotifs] = useState<ShopNotificationApi[]>([]);
  const [notifsSeenAt, setNotifsSeenAt] = useState<string>(() => {
    try {
      return localStorage.getItem('imc_shopper_notifs_seen') ?? '';
    } catch {
      return '';
    }
  });
  const [filters, setFiltersState] = useState<FilterState>(DEFAULT_FILTERS);
  const [priceCeil, setPriceCeil] = useState(PRICE_CEIL);
  const [sortBy, setSortBy] = useState<SortKey>('featured');
  const [grid, setGrid] = useState(true);
  const [search, setSearch] = useState('');

  // Initial load: the catalog (MOP prices when public, EPP when authed) plus —
  // only for signed-in employees — cart, wishlist, profile, notifications.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadCatalog(authed);
        if (cancelled) return;
        setCoupons(catalogCoupons());
        // Auto-fit the price ceiling to the loaded catalog, and lift the default
        // cap to it so products above the old static ceiling are visible by
        // default (a user-narrowed max is respected).
        const ceil = catalogPriceCeil();
        setPriceCeil(ceil);
        setFiltersState((f) => (f.priceMax >= PRICE_CEIL ? { ...f, priceMax: ceil } : f));
        if (!authed) return; // public: no cart/wishlist/profile
        const [c, w, p, n] = await Promise.all([
          shop.getCart(),
          shop.getWishlist(),
          shop.getProfile().catch(() => null),
          shop.getNotifications().catch(() => []),
        ]);
        if (cancelled) return;
        setCart(c.lines);
        setSubtotal(c.subtotal);
        setWishlist(w);
        setQrDiscount(p?.qrDiscount ?? null);
        setSmartEppEnabled(p?.smartEppEnabled ?? false);
        setCheckoutEnabled(p?.checkoutEnabled ?? false);
        setNotifs(n);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  const applyCartState = (c: { lines: CartLineView[]; subtotal: number }) => {
    setCart(c.lines);
    setSubtotal(c.subtotal);
  };

  // Public visitors are sent to the login before any cart/wishlist/order action.
  const requireAuth = useCallback((): boolean => {
    if (authed) return true;
    navigate('/');
    return false;
  }, [authed, navigate]);

  const addToCart = useCallback(async (id: string, shade: string, qty: number) => {
    if (!requireAuth()) return;
    applyCartState(await shop.addCart(id, shade, qty));
  }, [requireAuth]);
  const setLineQty = useCallback(async (itemId: string, qty: number) => {
    applyCartState(await shop.updateCart(itemId, qty));
  }, []);
  const removeLine = useCallback(async (itemId: string) => {
    applyCartState(await shop.removeCart(itemId));
  }, []);

  const placeOrder = useCallback(
    async (
      couponCode?: string,
      addressId?: string,
      billingAddressId?: string,
      payment?: RazorpayHandoff,
    ) => {
      const order = await shop.placeOrder(couponCode, addressId, billingAddressId, payment);
      applyCartState({ lines: [], subtotal: 0 });
      setAppliedCoupon(null);
      setCouponError(null);
      // A FIRST_ORDER exhibition discount is consumed by this order — refresh,
      // and the new order produces a fresh "order placed" alert.
      shop
        .getProfile()
        .then((p) => setQrDiscount(p.qrDiscount ?? null))
        .catch(() => undefined);
      shop
        .getNotifications()
        .then(setNotifs)
        .catch(() => undefined);
      return order;
    },
    [],
  );

  const cartCount = useMemo(() => cart.reduce((n, l) => n + l.qty, 0), [cart]);

  // Unread = any alert newer than the last time the Alerts screen was opened.
  const notifsUnread = useMemo(
    () => notifs.some((n) => !notifsSeenAt || n.at > notifsSeenAt),
    [notifs, notifsSeenAt],
  );
  const markNotifsSeen = useCallback(() => {
    const now = new Date().toISOString();
    setNotifsSeenAt(now);
    try {
      localStorage.setItem('imc_shopper_notifs_seen', now);
    } catch {
      /* ignore */
    }
  }, []);

  // ── wishlist ──
  const wishedIds = useMemo(() => new Set(wishlist.map((p) => p.id)), [wishlist]);
  const toggleWishlist = useCallback(
    async (id: string) => {
      if (!requireAuth()) return;
      setWishlist(wishedIds.has(id) ? await shop.removeWishlist(id) : await shop.addWishlist(id));
    },
    [wishedIds, requireAuth],
  );
  const isWished = useCallback((id: string) => wishedIds.has(id), [wishedIds]);

  // ── coupon (validated server-side against the live cart) ──
  const applyCoupon = useCallback(async (code: string) => {
    const res = await shop.validateCouponApi(code);
    if (res.ok && res.coupon) {
      setAppliedCoupon(res.coupon);
      setCouponError(null);
    } else {
      setAppliedCoupon(null);
      setCouponError(res.error ?? 'Invalid coupon code');
    }
  }, []);
  const removeCoupon = useCallback(() => {
    setAppliedCoupon(null);
    setCouponError(null);
  }, []);
  const clearCouponError = useCallback(() => setCouponError(null), []);

  // ── filters ──
  const setFilters = useCallback((patch: Partial<FilterState>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
  }, []);
  const clearFilters = useCallback(
    () => setFiltersState({ ...DEFAULT_FILTERS, priceMax: priceCeil }),
    [priceCeil],
  );
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.sub) n++;
    if (filters.brands.length) n++;
    if (filters.minRating) n++;
    if (filters.inStock) n++;
    if (filters.priceMin > PRICE_FLOOR || filters.priceMax < priceCeil) n++;
    return n;
  }, [filters, priceCeil]);

  const value: StoreCtxValue = {
    ready,
    authed,
    smartEppEnabled,
    checkoutEnabled,
    cart, addToCart, setLineQty, removeLine, cartCount, subtotal, placeOrder, qrDiscount,
    notifs, notifsUnread, markNotifsSeen,
    wishlist, toggleWishlist, isWished,
    coupons, appliedCoupon, couponError, applyCoupon, removeCoupon, clearCouponError,
    filters, setFilters, clearFilters, activeFilterCount, priceCeil,
    sortBy, setSortBy, grid, setGrid, search, setSearch,
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): StoreCtxValue {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
