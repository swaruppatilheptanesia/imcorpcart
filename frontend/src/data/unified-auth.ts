/** Unified (portal-agnostic) auth for the single login page at `/`.
 *  Calls the auth endpoints raw — deliberately NOT via createAuthApi, which is
 *  bound to one portal's store — then persists the session into the store of
 *  whichever portal the user's role maps to (RBAC routing). */

import { apiFetch, type LoginResult, type RegisterInput } from './http';
import { createAuthStore, type AuthUser } from './auth-store';

// createAuthStore is a stateless wrapper over localStorage keys, so these
// instances are interchangeable with the ones the portal api modules hold.
const PORTALS = {
  admin: { store: createAuthStore('admin'), path: '/super-admin' },
  company: { store: createAuthStore('company'), path: '/company' },
  reseller: { store: createAuthStore('reseller'), path: '/reseller' },
  shopper: { store: createAuthStore('shopper'), path: '/shop' },
} as const;

export type PortalKey = keyof typeof PORTALS;

export const ROLE_TO_PORTAL: Record<string, PortalKey> = {
  SUPER_ADMIN: 'admin',
  COMPANY_ADMIN: 'company',
  COMPANY_HR: 'company',
  RESELLER: 'reseller',
  EMPLOYEE_EPP: 'shopper',
  EMPLOYEE_SMART_EPP: 'shopper',
};

// Inverse map, for the portal apps' RBAC guard (checking-stage role check).
export const PORTAL_ROLES: Record<PortalKey, string[]> = {
  admin: [],
  company: [],
  reseller: [],
  shopper: [],
};
for (const [role, portal] of Object.entries(ROLE_TO_PORTAL)) PORTAL_ROLES[portal].push(role);

/** Store the session in the portal store the role maps to and return that
 *  portal's path. Throws for roles with no portal (LEASING_COMPANY, …). */
export function persistSession(accessToken: string, user: AuthUser): string {
  const key = ROLE_TO_PORTAL[user.role];
  if (!key) throw new Error('No portal is available for your account');
  const portal = PORTALS[key];
  portal.store.setToken(accessToken);
  portal.store.setUser(user);
  return portal.path;
}

// ─── Personal-email registration (GSTIN flow) ────────────────────────────────
// Mirror of the backend list (backend/src/utils/freemail.ts) — the backend is
// authoritative; this copy only drives the Register form's conditional fields.
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.in',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'zohomail.in',
  'rediffmail.com',
  'yandex.com',
  'gmx.com',
  'mail.com',
]);

export function isFreeMailEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1];
  return Boolean(domain && FREE_MAIL_DOMAINS.has(domain));
}

// Canonical 15-char Indian GSTIN: state code + PAN + entity + 'Z' + checksum.
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// ─── QR exhibition campaigns (public) ────────────────────────────────────────

export interface QrCampaignInfo {
  name: string;
  discountPercent: number;
  live: boolean;
}

/** What the registration page shows for a scanned campaign QR (404 → null). */
export async function getQrCampaign(token: string): Promise<QrCampaignInfo | null> {
  try {
    return await apiFetch<QrCampaignInfo>(`/auth/qr-campaign/${encodeURIComponent(token)}`, { auth: false });
  } catch {
    return null;
  }
}

export function login(email: string, password: string): Promise<LoginResult> {
  return apiFetch<LoginResult>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
}

export function register(input: RegisterInput): Promise<LoginResult> {
  return apiFetch<LoginResult>('/auth/register', { method: 'POST', body: input, auth: false });
}

export function verifyOtp(
  challengeToken: string,
  code: string,
): Promise<{ accessToken: string; user: AuthUser }> {
  return apiFetch('/auth/verify-otp', { method: 'POST', body: { challengeToken, code }, auth: false });
}
