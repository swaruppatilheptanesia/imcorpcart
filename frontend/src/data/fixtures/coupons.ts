import type { Coupon } from '../types';

/** 8 coupons — from promos(). */
export const coupons: Coupon[] = [
  { code: 'CORP10', type: 'pct', val: 10, cap: 10000, min: 0, scope: 'All products', status: 'active', used: 312, limit: 2000, ends: '31 Dec 2026' },
  { code: 'EPP15', type: 'pct', val: 15, cap: 8000, min: 40000, scope: 'Phones', status: 'active', used: 148, limit: 1000, ends: '31 Dec 2026' },
  { code: 'FLAT500', type: 'flat', val: 500, cap: 0, min: 0, scope: 'All products', status: 'active', used: 906, limit: 5000, ends: '31 Dec 2026' },
  { code: 'BAGS20', type: 'pct', val: 20, cap: 4000, min: 0, scope: 'Bags', status: 'active', used: 74, limit: 800, ends: '31 Dec 2026' },
  { code: 'WELCOME1000', type: 'flat', val: 1000, cap: 0, min: 50000, scope: 'All products', status: 'scheduled', used: 0, limit: 3000, ends: '01 Sep 2026' },
  { code: 'AUDIO10', type: 'pct', val: 10, cap: 2000, min: 0, scope: 'Accessories', status: 'scheduled', used: 0, limit: 1200, ends: '15 Aug 2026' },
  { code: 'SUMMER5', type: 'pct', val: 5, cap: 1500, min: 0, scope: 'All products', status: 'expired', used: 1420, limit: 1500, ends: '30 Jun 2026' },
  { code: 'DIWALI25', type: 'pct', val: 25, cap: 12000, min: 30000, scope: 'Phones', status: 'expired', used: 2000, limit: 2000, ends: '15 Nov 2025' },
];

export const couponScopes = ['All products', 'Phones', 'Accessories', 'Bags'];
