import { BarChart3, ShoppingBag, Package, Ticket, UploadCloud, type LucideIcon } from 'lucide-react';

export interface NavDef {
  key: string;
  label: string;
  icon: LucideIcon;
}

export const navDefs: NavDef[] = [
  { key: 'dashboard', label: 'Performance', icon: BarChart3 },
  { key: 'orders', label: 'Orders', icon: ShoppingBag },
  { key: 'products', label: 'Products', icon: Package },
  { key: 'coupons', label: 'Coupons & promotions', icon: Ticket },
  { key: 'bulk', label: 'Bulk operations', icon: UploadCloud },
];

export function activeNav(route: string): string {
  if (route === 'productEdit') return 'products';
  if (route === 'orderDetail') return 'orders';
  return route;
}

export interface RouteMeta {
  title: string;
  sub: string;
}

export const titles: Record<string, RouteMeta> = {
  dashboard: { title: 'Performance', sub: 'Your sales analytics' },
  orders: { title: 'My orders', sub: 'Orders containing your products' },
  products: { title: 'My listings', sub: 'Set your price & stock on imcorpcart products' },
  productEdit: { title: 'Edit listing', sub: 'Update your selling price and stock' },
  coupons: { title: 'Coupons & promotions', sub: 'Discount codes for your products' },
  bulk: { title: 'Bulk operations', sub: 'CSV import and price updates' },
};
