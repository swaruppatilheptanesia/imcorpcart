// Shared constants used across the API.

export const API_PREFIX = '/api';

export const PAGINATION = {
  defaultPage: 1,
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;

// OtpToken.purpose values (the schema stores this as a free-text string).
export const OTP_PURPOSE = {
  LOGIN_2FA: 'LOGIN_2FA',
  PASSWORDLESS_LOGIN: 'PASSWORDLESS_LOGIN',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;

// The roles allowed to use the Super Admin API surface built in this pass.
// Kept as a constant so route guards and future portals can reference it.
export const ADMIN_ROLES = ['SUPER_ADMIN'] as const;

// Demo accounts that skip email-OTP and sign in directly (all environments — see
// auth.service). The storefront demo (demo@imcorpcart.com) is also blocked from
// checkout. reseller@imcorpcart.com signs into the reseller portal (seed it +
// its demo products with `npm run db:seed-demo-reseller`). Lowercased for
// case-insensitive matching.
export const DEMO_LOGIN_EMAILS = new Set([
  'admin@imcorpcart.local',
  'demo@imcorpcart.com',
  'reseller@imcorpcart.com',
  // Smart EPP demo set (prisma/seed-demo-sepp.ts): shopper → HR → leasing company.
  'employee@imcorpcart.com',
  'hr@imcorpcart.com',
  'leasing@imcorpcart.com',
]);
export const isDemoLoginEmail = (email?: string | null): boolean =>
  !!email && DEMO_LOGIN_EMAILS.has(email.toLowerCase());

// Demo logins that may browse but never buy (checkout + Smart EPP requests are
// refused server-side, independent of the CHECKOUT_ENABLED gate). The other demo
// logins are full-function so the Smart EPP chain can be demoed end to end.
export const DEMO_VIEW_ONLY_EMAILS = new Set(['demo@imcorpcart.com']);
export const isDemoViewOnlyEmail = (email?: string | null): boolean =>
  !!email && DEMO_VIEW_ONLY_EMAILS.has(email.toLowerCase());
