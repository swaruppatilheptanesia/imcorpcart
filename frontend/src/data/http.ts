/** Thin fetch wrapper, instantiated per portal so each carries its own token
 *  source + expiry event. `createHttpClient(store)` returns { apiFetch, apiUpload };
 *  the admin client is re-exported under the original names so api.ts is
 *  untouched. A shared `createAuthApi` implements the common /auth endpoints. */

import { adminStore, type AuthStore, type AuthUser } from './auth-store';

// Base is empty by default → same-origin `/api` via the Vite proxy.
const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface RequestOpts {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  auth?: boolean; // default true
}

function buildUrl(path: string, query?: RequestOpts['query']): string {
  const url = `${API_BASE}/api${path}`;
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

export interface HttpClient {
  apiFetch<T = unknown>(path: string, opts?: RequestOpts): Promise<T>;
  apiUpload<T = unknown>(path: string, file: File, onProgress?: (pct: number) => void): Promise<T>;
}

export function createHttpClient(store: AuthStore): HttpClient {
  async function parse(res: Response): Promise<unknown> {
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      if (res.status === 401) {
        store.clearAuth();
        store.emitExpired();
      }
      const err = (json as { error?: { code?: string; message?: string; details?: unknown } })?.error;
      throw new ApiError(
        res.status,
        err?.code ?? 'ERROR',
        err?.message ?? `Request failed (${res.status})`,
        err?.details,
      );
    }
    return json;
  }

  async function apiFetch<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.auth !== false) {
      const token = store.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return (await parse(res)) as T;
  }

  function apiUpload<T = unknown>(
    path: string,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', buildUrl(path));
      const token = store.getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        const json = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(json as T);
        } else {
          if (xhr.status === 401) {
            store.clearAuth();
            store.emitExpired();
          }
          const err = (json as { error?: { code?: string; message?: string } })?.error;
          reject(new ApiError(xhr.status, err?.code ?? 'ERROR', err?.message ?? 'Upload failed'));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Network error during upload'));
      const form = new FormData();
      form.append('file', file);
      xhr.send(form);
    });
  }

  return { apiFetch, apiUpload };
}

// ─── Shared auth API (login → OTP → session), reused by every live portal ─────

export interface LoginResult {
  challengeToken: string;
  devOtp?: string;
  message: string;
  // Present only when 2FA is disabled server-side (beta): the server signs the
  // user in directly, so there is no OTP step to perform.
  accessToken?: string;
  user?: AuthUser;
  // Self-registration only: the account is created PENDING Super Admin approval —
  // no session/OTP is issued, and the register screen shows a pending notice.
  pending?: boolean;
}

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  // Required (by the backend) when the email is a free/personal provider —
  // the company is then created keyed on GSTIN instead of the email domain.
  gstin?: string;
  companyName?: string;
  // Exhibition campaign QR token (?qr=<token>) — grants the campaign discount.
  qrToken?: string;
}

export function createAuthApi(client: HttpClient, store: AuthStore) {
  return {
    async login(email: string, password: string): Promise<LoginResult> {
      const r = await client.apiFetch<LoginResult>('/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      // 2FA disabled (beta): persist the session so the caller can go straight in.
      if (r.accessToken && r.user) {
        store.setToken(r.accessToken);
        store.setUser(r.user);
      }
      return r;
    },
    async register(input: RegisterInput): Promise<LoginResult> {
      const r = await client.apiFetch<LoginResult>('/auth/register', {
        method: 'POST',
        body: input,
        auth: false,
      });
      if (r.accessToken && r.user) {
        store.setToken(r.accessToken);
        store.setUser(r.user);
      }
      return r;
    },
    async verifyOtp(challengeToken: string, code: string): Promise<AuthUser> {
      const r = await client.apiFetch<{ accessToken: string; user: AuthUser }>('/auth/verify-otp', {
        method: 'POST',
        body: { challengeToken, code },
        auth: false,
      });
      store.setToken(r.accessToken);
      store.setUser(r.user);
      return r.user;
    },
    async me(): Promise<AuthUser> {
      const r = await client.apiFetch<{ user: AuthUser }>('/auth/me');
      return r.user;
    },
    async logout(): Promise<void> {
      try {
        await client.apiFetch('/auth/logout', { method: 'POST' });
      } finally {
        store.clearAuth();
      }
    },
  };
}

// ─── Admin client (back-compat: api.ts imports apiFetch/apiUpload from here) ───
const adminClient = createHttpClient(adminStore);
export const apiFetch = adminClient.apiFetch;
export const apiUpload = adminClient.apiUpload;
