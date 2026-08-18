import type {
  DateRange,
  Partner,
  RangeStats,
  RecentOrder,
  TopCompany,
  TopProduct,
  Wishlisted,
} from '../types';

/** Dashboard stats keyed by date range — from rangeData. */
export const rangeData: Record<DateRange, RangeStats> = {
  '7D': { label: '7D', full: 'Last 7 days', gmv: '₹1.12Cr', gmvDelta: '8.2%', orders: '298', ordersDelta: '4.4%', margin: '18.1%', marginVal: '₹20.3L', marginDelta: '+1.2 pts' },
  '30D': { label: '30D', full: 'Last 30 days', gmv: '₹4.82Cr', gmvDelta: '12.4%', orders: '1,284', ordersDelta: '6.1%', margin: '18.6%', marginVal: '₹89.6L', marginDelta: '+2.1 pts' },
  QTD: { label: 'QTD', full: 'Quarter to date', gmv: '₹13.9Cr', gmvDelta: '15.8%', orders: '3,910', ordersDelta: '9.7%', margin: '19.0%', marginVal: '₹2.64Cr', marginDelta: '+2.8 pts' },
  YTD: { label: 'YTD', full: 'Year to date', gmv: '₹52.1Cr', gmvDelta: '22.3%', orders: '14,720', ordersDelta: '13.5%', margin: '19.4%', marginVal: '₹10.1Cr', marginDelta: '+3.4 pts' },
};

export const orderVolumeSpark = [18, 22, 19, 26, 24, 31, 28, 35, 33, 40, 38, 46];

export const topCompanies: TopCompany[] = [
  { name: 'Nexus Systems', spend: '₹1.42Cr', pct: '100%' },
  { name: 'Acme Corp', spend: '₹1.08Cr', pct: '76%' },
  { name: 'Orbit Financial', spend: '₹86.4L', pct: '61%' },
  { name: 'Zenith Retail', spend: '₹58.2L', pct: '41%' },
];

export const topProducts: TopProduct[] = [
  { name: 'iPhone 15 Pro · 256GB', units: '312', value: '₹3.9Cr', g1: '#4a7fc0', g2: '#123a72' },
  { name: 'Galaxy S24 Ultra', units: '268', value: '₹3.48Cr', g1: '#2b2f36', g2: '#0b0d10' },
  { name: 'AirPods Pro (2nd gen)', units: '540', value: '₹1.34Cr', g1: '#f2f3f5', g2: '#c6cad2' },
  { name: 'OnePlus 12', units: '204', value: '₹1.32Cr', g1: '#1f6f52', g2: '#0a2f22' },
  { name: 'Everyday Backpack 20L', units: '186', value: '₹35.3L', g1: '#6a5240', g2: '#332417' },
  { name: '65W GaN Charger', units: '410', value: '₹14.3L', g1: '#f2f3f5', g2: '#c6cad2' },
];

export const partners: Partner[] = [
  { name: 'TechnoReseller', type: 'Reseller · Phones', gmv: '₹2.4Cr', onTime: '96%', otColor: 'var(--success)', dot: 'var(--v-techno)' },
  { name: 'MobileHub', type: 'Reseller · Phones', gmv: '₹1.1Cr', onTime: '92%', otColor: 'var(--success)', dot: 'var(--v-mobilehub)' },
  { name: 'GadgetPro', type: 'Reseller · Accessories', gmv: '₹64.2L', onTime: '89%', otColor: 'var(--warning)', dot: 'var(--v-gadgetpro)' },
  { name: 'UrbanCarry', type: 'Reseller · Bags', gmv: '₹41.8L', onTime: '94%', otColor: 'var(--success)', dot: 'var(--v-urbancarry)' },
  { name: 'SwiftShip Logistics', type: 'Fulfillment', gmv: '—', onTime: '97%', otColor: 'var(--success)', dot: 'var(--info)' },
  { name: 'MetroDispatch', type: 'Fulfillment', gmv: '—', onTime: '90%', otColor: 'var(--warning)', dot: 'var(--info)' },
];

export const topWishlisted: Wishlisted[] = [
  { name: 'iPhone 15 Pro · 256GB', saves: '1,284', pct: '100%', trend: '▲ 18%', g1: '#4a7fc0', g2: '#123a72' },
  { name: 'Galaxy S24 Ultra', saves: '1,043', pct: '81%', trend: '▲ 12%', g1: '#2b2f36', g2: '#0b0d10' },
  { name: 'AirPods Pro (2nd gen)', saves: '922', pct: '72%', trend: '▲ 24%', g1: '#f2f3f5', g2: '#c6cad2' },
  { name: 'Pixel 8 Pro', saves: '648', pct: '50%', trend: '▲ 6%', g1: '#7a8fae', g2: '#3a465c' },
  { name: 'Everyday Backpack 20L', saves: '512', pct: '40%', trend: '▲ 9%', g1: '#6a5240', g2: '#332417' },
];

export const recentOrders: RecentOrder[] = [
  { id: '#IMC-20492', company: 'Nexus Systems', product: 'iPhone 15 Pro', value: '₹1.24L', status: 'Processing', tone: 'warning' },
  { id: '#IMC-20489', company: 'Acme Corp', product: 'OnePlus 12', value: '₹65.0K', status: 'Processing', tone: 'warning' },
  { id: '#IMC-20485', company: 'Orbit Financial', product: '2× Galaxy S24 Ultra', value: '₹2.60L', status: 'In transit', tone: 'info' },
  { id: '#IMC-20478', company: 'Zenith Retail', product: 'AirPods Pro + Glass', value: '₹25.5K', status: 'Delivered', tone: 'success' },
  { id: '#IMC-20470', company: 'Vertex Health', product: 'Backpack + Sleeve', value: '₹21.5K', status: 'Delivered', tone: 'success' },
];

export const deliveryDonut = [
  { label: 'On time', pct: 62, color: 'var(--success)' },
  { label: 'Slightly late', pct: 26, color: 'var(--warning)' },
  { label: 'Delayed', pct: 12, color: 'var(--error)' },
];
