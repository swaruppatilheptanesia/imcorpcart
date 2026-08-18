/** Per-portal JWT + user persistence in localStorage so a refresh keeps the
 *  session. Each portal gets its own storage keys + expiry event so signing into
 *  one portal never leaks a session into another. No dependency — plain Web
 *  Storage. The admin store is re-exported under the original names so the
 *  Super Admin portal + api.ts keep working unchanged. */

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
}

export interface AuthStore {
  getToken(): string | null;
  setToken(token: string): void;
  getStoredUser(): AuthUser | null;
  setUser(user: AuthUser): void;
  clearAuth(): void;
  readonly expiredEvent: string;
  emitExpired(): void;
}

// Build a namespaced store. portal 'admin' → keys imc_admin_jwt / imc_admin_user
// and event 'auth:expired' (preserves the original admin contract).
export function createAuthStore(portal: string): AuthStore {
  const TOKEN_KEY = `imc_${portal}_jwt`;
  const USER_KEY = `imc_${portal}_user`;
  const expiredEvent = portal === 'admin' ? 'auth:expired' : `auth:expired:${portal}`;

  return {
    expiredEvent,
    getToken: () => {
      try {
        return localStorage.getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    },
    setToken: (token: string) => {
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* storage unavailable (private mode) — session just won't persist */
      }
    },
    getStoredUser: () => {
      try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? (JSON.parse(raw) as AuthUser) : null;
      } catch {
        return null;
      }
    },
    setUser: (user: AuthUser) => {
      try {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } catch {
        /* ignore */
      }
    },
    clearAuth: () => {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } catch {
        /* ignore */
      }
    },
    emitExpired: () => window.dispatchEvent(new CustomEvent(expiredEvent)),
  };
}

// ─── Admin store + back-compat named exports (super-admin + api.ts import these) ──
export const adminStore = createAuthStore('admin');

export const getToken = adminStore.getToken;
export const setToken = adminStore.setToken;
export const getStoredUser = adminStore.getStoredUser;
export const setUser = adminStore.setUser;
export const clearAuth = adminStore.clearAuth;
export const AUTH_EXPIRED_EVENT = adminStore.expiredEvent;
export const emitAuthExpired = adminStore.emitExpired;
