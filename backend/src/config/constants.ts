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

// Demo accounts that skip email-OTP and sign in directly (dev/testing only — the
// bypass is gated to non-production in auth.service, so this never weakens prod
// auth). The storefront demo (demo@imcorpcart.com) is also blocked from checkout.
// Lowercased for case-insensitive matching.
export const DEMO_LOGIN_EMAILS = new Set(['admin@imcorpcart.local', 'demo@imcorpcart.com']);
export const isDemoLoginEmail = (email?: string | null): boolean =>
  !!email && DEMO_LOGIN_EMAILS.has(email.toLowerCase());
