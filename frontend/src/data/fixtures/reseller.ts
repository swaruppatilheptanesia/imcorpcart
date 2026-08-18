import { products } from './catalog';
import type { Product } from '../types';
import type { ResellerDashboard, ResellerCoupon, ResellerOrder } from '../store-types';

export const RESELLER_VENDOR = 'TechnoReseller' as const;

// The reseller's own catalog — the 6 TechnoReseller SKUs from the shared catalog.
export const resellerProducts: Product[] = products.filter((p) => p.vendor === RESELLER_VENDOR);

// Performance dashboard — all numbers scoped to their catalog.
export const resellerDashboard: ResellerDashboard = {
  salesValue: '₹4.82Cr',
  salesDelta: '▲ 12.4% vs previous',
  orderVolume: '1,284',
  orderDelta: '▲ 6.1%',
  spark: [18, 22, 19, 26, 24, 31, 28, 35, 33, 40, 38, 46],
  deliveryPct: '94%',
  deliveryNote: '18 delayed · avg 3.2 days',
  bestSellers: [
    { name: 'Galaxy S24 Ultra', g1: '#2b2f36', g2: '#0b0d10', metric: '96 sold' },
    { name: 'Galaxy A55 5G', g1: '#c8a24a', g2: '#7a5f1e', metric: '188 sold' },
  ],
  worstSellers: [{ name: 'Vivo X100 Pro', g1: '#3a2f5a', g2: '#171029', metric: '6 sold' }],
  topCustomers: [
    { name: 'Nexus Systems', spend: '₹1.42Cr' },
    { name: 'Acme Corp', spend: '₹98.4L' },
    { name: 'Orbit Financial', spend: '₹64.2L' },
  ],
  mostWishlisted: [
    { name: 'Galaxy S24 Ultra', g1: '#2b2f36', g2: '#0b0d10', metric: '▲ 16%' },
    { name: 'Galaxy A55 5G', g1: '#c8a24a', g2: '#7a5f1e', metric: '▲ 11%' },
    { name: 'Galaxy Buds3 Pro', g1: '#7d8794', g2: '#3d434c', metric: '▲ 9%' },
    { name: 'Vivo X100 Pro', g1: '#3a2f5a', g2: '#171029', metric: '▲ 4%' },
  ],
};

// Their own discount codes (scopes limited to their categories — no Bags).
export const resellerCoupons: ResellerCoupon[] = [
  { code: 'TECHNO10', type: 'pct', val: 10, cap: 8000, scope: 'All my products', status: 'active', used: 214, limit: 1500, ends: '31 Dec 2026' },
  { code: 'GALAXY15', type: 'pct', val: 15, cap: 9000, min: 40000, scope: 'Phones', status: 'active', used: 96, limit: 800, ends: '31 Dec 2026' },
  { code: 'BUDS500', type: 'flat', val: 500, scope: 'Accessories', status: 'active', used: 172, limit: 1000, ends: '31 Dec 2026' },
  { code: 'A55DEAL', type: 'pct', val: 12, cap: 5000, scope: 'Phones', status: 'scheduled', used: 0, limit: 600, ends: '15 Aug 2026' },
  { code: 'FEST2025', type: 'pct', val: 12, cap: 6000, scope: 'All my products', status: 'expired', used: 642, limit: 1000, ends: '15 Nov 2025' },
];

export const resellerCouponScopes = ['All my products', 'Phones', 'Accessories'];

// Orders that include their products.
export const resellerOrders: ResellerOrder[] = [
  { id: '#IMC-20485', customer: 'Neha Kapoor', company: 'Orbit Financial', status: 'In transit', total: 259998, date: '1 Jul 2026' },
  { id: '#IMC-20461', customer: 'Priya Nair', company: 'Nexus Systems', status: 'Delivered', total: 39999, date: '29 Jun 2026' },
  { id: '#IMC-20447', customer: 'Arjun Rao', company: 'Acme Corp', status: 'Delivered', total: 17999, date: '27 Jun 2026' },
  { id: '#IMC-20432', customer: 'Meera Shah', company: 'Zenith Retail', status: 'Processing', total: 129999, date: '26 Jun 2026' },
  { id: '#IMC-20419', customer: 'Karan Shah', company: 'Vertex Health', status: 'Cancelled', total: 1799, date: '24 Jun 2026' },
];

// Reseller demo login accounts.
export const resellerDemoAccounts = [
  { name: 'TechnoReseller', sub: 'Vendor account', email: 'sales@technoreseller.com' },
];
export const RESELLER_DEMO_PASSWORD = 'imcorp@2026';
