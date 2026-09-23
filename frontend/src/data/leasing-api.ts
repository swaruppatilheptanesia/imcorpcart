/** Leasing-company portal data layer — live API via a leasing-scoped http client
 *  (token key imc_leasing_jwt). Mirrors company-api.ts but for /api/leasing/*. */

import { createAuthStore } from './auth-store';
import { createHttpClient, createAuthApi } from './http';
import type { SeppQuote, SeppRequestView } from './sepp-types';

export const leasingStore = createAuthStore('leasing');
const client = createHttpClient(leasingStore);
const authApi = createAuthApi(client, leasingStore);

export const login = authApi.login;
export const verifyOtp = authApi.verifyOtp;
export const me = authApi.me;
export const logout = authApi.logout;

// ─── Domain types ────────────────────────────────────────────────────────────

export type AdvanceFeeType = 'FIXED' | 'PERCENT';

// Lease parameters the leasing company controls (feed every attached company's
// Smart-EPP calculator).
export interface LeaseParams {
  id: string;
  name: string;
  gstin: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  ptpm: number; // rental per ₹1000 of asset per month (incl. GST)
  defaultTenureMonths: number;
  repurchasePct: number;
  pvDiscountLeasePct: number;
  pvDiscountRepurchasePct: number;
  advanceFeeType: AdvanceFeeType;
  advanceFeeValue: number;
}

export interface SampleQuote {
  assetCost: number;
  quote: SeppQuote;
  advance: number;
}

export interface LeasingProfile extends LeaseParams {
  operator: { name: string; email: string } | null;
  stats: {
    companies: number;
    pendingRequests: number;
    approvedRequests: number;
    rejectedRequests: number;
    financedTotal: number;
    monthlyBook: number;
  };
}

export type LeaseParamsInput = Partial<
  Pick<
    LeaseParams,
    | 'name'
    | 'contactPhone'
    | 'ptpm'
    | 'defaultTenureMonths'
    | 'repurchasePct'
    | 'pvDiscountLeasePct'
    | 'pvDiscountRepurchasePct'
    | 'advanceFeeType'
    | 'advanceFeeValue'
  >
>;

export interface LeasingCompanyRow {
  id: string;
  name: string;
  domain: string | null;
  status: string;
  smartEppEnabled: boolean;
  adldPct: number | null;
  incomeTaxPct: number;
  employees: number;
  requests: { pending: number; active: number; rejected: number };
}

export type LeasingQueueFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'all';

export interface LeasingDecisionInput {
  decision: 'APPROVED' | 'REJECTED';
  comments?: string;
  tenureMonths?: number;
  emiAmount?: number;
}

// ─── Accessors ───────────────────────────────────────────────────────────────

export function getProfile(): Promise<LeasingProfile> {
  return client.apiFetch('/leasing/profile');
}

export function getParams(): Promise<LeaseParams & { sample: SampleQuote }> {
  return client.apiFetch('/leasing/params');
}

export function updateParams(body: LeaseParamsInput): Promise<LeaseParams & { sample: SampleQuote }> {
  return client.apiFetch('/leasing/params', { method: 'PATCH', body });
}

export function previewParams(
  body: LeaseParamsInput & { assetCost?: number; gstPct?: number; incomeTaxPct?: number; adldPct?: number },
): Promise<SampleQuote> {
  return client.apiFetch('/leasing/params/preview', { method: 'POST', body });
}

export async function getCompanies(): Promise<LeasingCompanyRow[]> {
  const r = await client.apiFetch<{ data: LeasingCompanyRow[] }>('/leasing/companies');
  return r.data;
}

export async function getRequests(status?: LeasingQueueFilter): Promise<SeppRequestView[]> {
  const r = await client.apiFetch<{ data: SeppRequestView[] }>('/leasing/requests', { query: { status } });
  return r.data;
}

export function getRequest(id: string): Promise<SeppRequestView> {
  return client.apiFetch(`/leasing/requests/${id}`);
}

export function decideRequest(id: string, body: LeasingDecisionInput): Promise<SeppRequestView> {
  return client.apiFetch(`/leasing/requests/${id}/decision`, { method: 'POST', body });
}
