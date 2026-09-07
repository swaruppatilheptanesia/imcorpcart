import {
  LayoutDashboard,
  Package,
  FolderTree,
  ShoppingBag,
  Users,
  BarChart3,
  CreditCard,
  UploadCloud,
  QrCode,
  GalleryHorizontalEnd,
  Star,
  IndianRupee,
  MapPin,
  Plug,
  Download,
  type LucideIcon,
} from 'lucide-react';

export interface NavDef {
  key: string; // route segment
  label: string;
  icon: LucideIcon;
}

export const navDefs: NavDef[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'products', label: 'Products', icon: Package },
  { key: 'categories', label: 'Categories', icon: FolderTree },
  { key: 'pincodes', label: 'Pincodes', icon: MapPin },
  { key: 'partners', label: 'Partners', icon: Plug },
  { key: 'vendor-sources', label: 'Vendor sources', icon: Download },
  { key: 'orders', label: 'Orders', icon: ShoppingBag },
  { key: 'users', label: 'Users & companies', icon: Users },
  { key: 'reseller-pricing', label: 'Reseller pricing', icon: IndianRupee },
  { key: 'reviews', label: 'Reviews', icon: Star },
  { key: 'qr-campaigns', label: 'QR campaigns', icon: QrCode },
  { key: 'banners', label: 'Banners', icon: GalleryHorizontalEnd },
  { key: 'reports', label: 'Reports', icon: BarChart3 },
  { key: 'payments', label: 'Payments', icon: CreditCard },
  { key: 'bulk', label: 'Bulk operations', icon: UploadCloud },
];

/** Sub-routes fold onto their parent nav item for active highlighting. */
export function activeNav(route: string): string {
  if (route === 'productDetail' || route === 'productEdit') return 'products';
  if (route === 'orderDetail') return 'orders';
  if (route === 'partnerDetail') return 'partners';
  if (route === 'vendorSourceDetail') return 'vendor-sources';
  return route;
}

export interface RouteMeta {
  title: string;
  sub: string;
}

export const titles: Record<string, RouteMeta> = {
  dashboard: { title: 'Dashboard', sub: 'Real-time overview across all companies' },
  products: { title: 'Products', sub: 'The platform catalog across every vendor' },
  productDetail: { title: 'Product detail', sub: 'Master record + sellers' },
  productEdit: { title: 'Product', sub: 'Author the product master' },
  categories: { title: 'Categories', sub: 'Category & sub-category master' },
  pincodes: { title: 'Pincodes', sub: 'Courier delivery TAT & serviceability per pincode' },
  partners: { title: 'Partners', sub: 'Integration partners — API access, catalogue & webhooks' },
  partnerDetail: { title: 'Partner', sub: 'Integration, access, catalogue & activity' },
  'vendor-sources': { title: 'Vendor sources', sub: 'Integrated vendors — sync their products into the catalog' },
  vendorSourceDetail: { title: 'Vendor source', sub: 'Sync, configure & import log' },
  orders: { title: 'Orders', sub: 'All orders across every company' },
  orderDetail: { title: 'Order detail', sub: 'Manifest, timeline, and documents' },
  users: { title: 'Users & companies', sub: 'Companies, employees, resellers, partners' },
  'reseller-pricing': { title: 'Reseller pricing', sub: 'Reseller vs customer price and platform commission per offer' },
  reviews: { title: 'Reviews', sub: 'Verify customer product reviews before they publish' },
  'qr-campaigns': { title: 'QR campaigns', sub: 'Exhibition QR codes and registration discounts' },
  banners: { title: 'Banners', sub: 'Promotional banners on the shopper Home carousel' },
  reports: { title: 'Reports', sub: 'Export platform analytics' },
  payments: { title: 'Payments', sub: 'Surcharge and gateway configuration' },
  bulk: { title: 'Bulk operations', sub: 'CSV import and price updates' },
};
