import type { Order, OrderStatus, SemanticTone } from '../types';

/** 6 orders — from allOrders(). */
const rawOrders: Omit<Order, 'dispatchDate' | 'vendor' | 'productName' | 'itemCount'>[] = [
  {
    id: '#IMC-20492', company: 'Nexus Systems', buyer: 'Sara Iyer', date: '2 Jul 2026',
    status: 'Processing', courier: 'Awaiting dispatch', awb: '—', total: 124900,
    items: [{ name: 'iPhone 15 Pro · 256GB', shade: 'Blue Titanium', g1: '#4a7fc0', g2: '#123a72', qty: 1, price: 124900 }],
  },
  {
    id: '#IMC-20489', company: 'Acme Corp', buyer: 'Rohan Mehta', date: '2 Jul 2026',
    status: 'Processing', courier: 'BlueDart', awb: 'BD772140923', total: 64999,
    items: [{ name: 'OnePlus 12 · 256GB', shade: 'Flowy Emerald', g1: '#1f6f52', g2: '#0a2f22', qty: 1, price: 64999 }],
  },
  {
    id: '#IMC-20485', company: 'Orbit Financial', buyer: 'Neha Kapoor', date: '1 Jul 2026',
    status: 'In transit', courier: 'Delhivery', awb: 'DL559871002', total: 259998,
    items: [{ name: 'Galaxy S24 Ultra · 512GB', shade: 'Titanium Black', g1: '#2b2f36', g2: '#0b0d10', qty: 2, price: 129999 }],
  },
  {
    id: '#IMC-20478', company: 'Zenith Retail', buyer: 'Karan Shah', date: '30 Jun 2026',
    status: 'Delivered', courier: 'BlueDart', awb: 'BD771029384', total: 25499,
    items: [
      { name: 'AirPods Pro (2nd gen)', shade: 'White', g1: '#f2f3f5', g2: '#c6cad2', qty: 1, price: 24900 },
      { name: 'Tempered Glass (2 pack)', shade: 'Clear', g1: '#dfe3ea', g2: '#b3b9c4', qty: 1, price: 599 },
    ],
  },
  {
    id: '#IMC-20470', company: 'Vertex Health', buyer: 'Ananya Rao', date: '29 Jun 2026',
    status: 'Delivered', courier: 'Delhivery', awb: 'DL559012773', total: 21498,
    items: [
      { name: 'Everyday Backpack 20L', shade: 'Coyote', g1: '#6a5240', g2: '#332417', qty: 1, price: 18999 },
      { name: 'Slim Laptop Sleeve 14"', shade: 'Charcoal', g1: '#3a3f47', g2: '#16191d', qty: 1, price: 2499 },
    ],
  },
  {
    id: '#IMC-20465', company: 'Acme Corp', buyer: 'Rohan Mehta', date: '28 Jun 2026',
    status: 'Cancelled', courier: '—', awb: '—', total: 27999,
    items: [{ name: 'Nothing Phone (2a)', shade: 'White', g1: '#e6e8ec', g2: '#b6bcc6', qty: 1, price: 27999 }],
  },
];

/** Derive the list-column fields the API supplies live; demo values for the fixture. */
export const orders: Order[] = rawOrders.map((o) => ({
  ...o,
  dispatchDate: o.awb === '—' ? '—' : o.date,
  vendor: 'imcorpcart',
  productName: o.items[0]?.name ?? '—',
  itemCount: o.items.length,
}));

export const orderStatusTone: Record<OrderStatus, SemanticTone> = {
  Processing: 'warning',
  'In transit': 'info',
  Delivered: 'success',
  Cancelled: 'error',
};

/** 7-step timeline + how far each status has progressed. */
export const timelineSteps = [
  'Order placed',
  'Confirmed',
  'Packed',
  'Dispatched',
  'In transit',
  'Out for delivery',
  'Delivered',
];

export const statusToStep: Record<OrderStatus, number> = {
  Processing: 2,
  'In transit': 5,
  Delivered: 7,
  Cancelled: 1,
};

export function bucketOf(status: OrderStatus): 'active' | 'delivered' | 'cancelled' {
  if (status === 'Delivered') return 'delivered';
  if (status === 'Cancelled') return 'cancelled';
  return 'active';
}
