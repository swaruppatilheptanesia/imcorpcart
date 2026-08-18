import { Store, Search, ShoppingCart, Package, User, type LucideIcon } from 'lucide-react';

export interface TabDef {
  key: string; // route segment
  label: string;
  icon: LucideIcon;
}

export const tabs: TabDef[] = [
  { key: 'home', label: 'Store', icon: Store },
  { key: 'search', label: 'Search', icon: Search },
  { key: 'cart', label: 'Cart', icon: ShoppingCart },
  { key: 'orders', label: 'Orders', icon: Package },
  { key: 'profile', label: 'Profile', icon: User },
];

// Routes where the mobile bottom tab bar is hidden (immersive/flow screens).
export const TAB_HIDDEN = new Set([
  'checkout',
  'processing',
  'success',
  'failed',
  'product',
  'tracking',
  'orderDetail',
]);

// Routes that show a back chevron in the mobile header.
export const SHOW_BACK = new Set([
  'product',
  'cart',
  'checkout',
  'orderDetail',
  'tracking',
  'notifs',
]);

// Per-route mobile header title.
export const routeTitles: Record<string, string> = {
  home: 'Store',
  search: 'Search',
  product: 'Product',
  cart: 'Cart',
  checkout: 'Checkout',
  processing: 'Payment',
  success: 'Order placed',
  failed: 'Payment failed',
  orders: 'Your orders',
  orderDetail: 'Order detail',
  tracking: 'Tracking',
  wishlist: 'Saved',
  notifs: 'Alerts',
  about: 'About',
  contact: 'Contact',
  profile: 'Profile',
};
