import { useOutletContext } from 'react-router-dom';

// Shell-owned handles passed to routed screens via the outlet context.
// (Cart/wishlist/coupon/filter state lives in useStore(), not here.)
export interface ShopShellCtx {
  openFilter: () => void;
}

export function useShopShell() {
  return useOutletContext<ShopShellCtx>();
}
