/** Company (HR) portal data layer — live API via a company-scoped http client
 *  (token key imc_company_jwt). Mirrors api.ts but for /api/company/*. */

import { createAuthStore } from './auth-store';
import { createHttpClient, createAuthApi } from './http';
import type { SeppRequestView, SeppBranch } from './sepp-types';

export const companyStore = createAuthStore('company');
const client = createHttpClient(companyStore);
const authApi = createAuthApi(client, companyStore);

// Auth (shared shape with the other portals).
export const login = authApi.login;
export const verifyOtp = authApi.verifyOtp;
export const me = authApi.me;
export const logout = authApi.logout;

// ─── Domain types ────────────────────────────────────────────────────────────

export interface CompanyProfile {
  id: string;
  name: string;
  gstin: string | null;
  emailDomain: string | null;
  status: string;
  adminName: string | null;
  adminEmail: string | null;
  employeeCount: number;
  createdAt: string;
}

export interface CompanyDashboard {
  stats: {
    employees: number;
    activeEmployees: number;
    orders: number;
    orderValue: number;
    avgOrderValue: number;
    seppPending: number; // Smart EPP requests awaiting HR
    seppActive: number; // approved / financed leases
    seppInstallmentsDue: number; // installments due to date not yet recorded as paid
  };
  recentOrders: { id: string; buyer: string; product: string; value: number; status: string; date: string }[];
  topEmployees: { employeeId: string; name: string; spend: number; orders: number }[];
}

export interface CompanyEmployee {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  employeeCode: string;
  department: string | null;
  program: string;
  monthlySalary: number;
  creditLimit: number | null; // Smart-EPP purchase limit (HR-set)
  creditAvailable: number | null; // ledger-backed: limit − reserved − consumed
  creditReserved: number;
  seppRequestCount: number;
  status: string;
  orderCount: number;
  createdAt: string;
}

export interface CreateEmployeeInput {
  fullName: string;
  email: string;
  phone?: string;
  employeeCode?: string;
  department?: string;
  monthlySalary?: number;
  creditLimit?: number;
}

export interface UpdateEmployeeInput {
  department?: string;
  monthlySalary?: number;
  creditLimit?: number | null;
  status?: 'ACTIVE' | 'SUSPENDED';
}

// ─── Accessors ───────────────────────────────────────────────────────────────

export function getProfile(): Promise<CompanyProfile> {
  return client.apiFetch<CompanyProfile>('/company/profile');
}

export function getDashboard(): Promise<CompanyDashboard> {
  return client.apiFetch<CompanyDashboard>('/company/dashboard');
}

export async function getEmployees(q?: string): Promise<CompanyEmployee[]> {
  const r = await client.apiFetch<{ data: CompanyEmployee[] }>('/company/employees', { query: { q } });
  return r.data;
}

export function createEmployee(input: CreateEmployeeInput): Promise<CompanyEmployee & { tempPassword?: string }> {
  return client.apiFetch('/company/employees', { method: 'POST', body: input });
}

export function updateEmployee(id: string, input: UpdateEmployeeInput): Promise<CompanyEmployee> {
  return client.apiFetch(`/company/employees/${id}`, { method: 'PATCH', body: input });
}

export interface CompanyOrderRow {
  id: string;
  orderNo: string;
  status: string;
  total: number;
  createdAt: string;
  employee: { employeeCode: string; user: { fullName: string } };
  reseller: { id: string; name: string } | null;
}

export async function getOrders(bucket?: string): Promise<CompanyOrderRow[]> {
  const r = await client.apiFetch<{ data: CompanyOrderRow[] }>('/company/orders', { query: { bucket } });
  return r.data;
}

// ─── Smart EPP — HR stage-1 approval queue ───────────────────────────────────

export type SeppQueueFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'all';

export async function getSeppRequests(status?: SeppQueueFilter): Promise<SeppRequestView[]> {
  const r = await client.apiFetch<{ data: SeppRequestView[] }>('/company/sepp/requests', { query: { status } });
  return r.data;
}
export function getSeppRequest(id: string): Promise<SeppRequestView> {
  return client.apiFetch(`/company/sepp/requests/${id}`);
}
export function decideSeppRequest(id: string, decision: 'APPROVED' | 'REJECTED', comments?: string): Promise<SeppRequestView> {
  return client.apiFetch(`/company/sepp/requests/${id}/decision`, { method: 'POST', body: { decision, comments } });
}
/** HR records a payroll-deducted EMI as paid → restores that month's slice of the employee's limit. */
export function markInstallmentPaid(id: string, installmentNo: number): Promise<SeppRequestView> {
  return client.apiFetch(`/company/sepp/requests/${id}/installments/${installmentNo}/paid`, { method: 'POST' });
}

// ─── Office branches (Smart-EPP delivery addresses) ──────────────────────────

export type CompanyBranch = SeppBranch & { createdAt: string };
export interface BranchInput {
  label: string;
  contactName: string;
  contactPhone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
}
export async function getBranches(): Promise<CompanyBranch[]> {
  const r = await client.apiFetch<{ data: CompanyBranch[] }>('/company/addresses');
  return r.data;
}
export function createBranch(body: BranchInput): Promise<CompanyBranch> {
  return client.apiFetch('/company/addresses', { method: 'POST', body });
}
export function updateBranch(id: string, body: Partial<BranchInput>): Promise<CompanyBranch> {
  return client.apiFetch(`/company/addresses/${id}`, { method: 'PATCH', body });
}
export function deleteBranch(id: string): Promise<{ ok: boolean }> {
  return client.apiFetch(`/company/addresses/${id}`, { method: 'DELETE' });
}

// Company EPP orders reuse the admin order list shape via the shop-less path —
// the HR dashboard already surfaces recent orders, so a dedicated list here
// reads them from the dashboard payload.

// Demo login chips.
export const demoAccounts = [
  { label: 'Acme Corp — HR', sub: 'admin@acme.com', fill: 'admin@acme.com' },
  { label: 'Nexus Systems — HR', sub: 'admin@nexus.com', fill: 'admin@nexus.com' },
];
export const DEMO_PASSWORD = 'imcorp@2026';
