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
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;

// The roles allowed to use the Super Admin API surface built in this pass.
// Kept as a constant so route guards and future portals can reference it.
export const ADMIN_ROLES = ['SUPER_ADMIN'] as const;
