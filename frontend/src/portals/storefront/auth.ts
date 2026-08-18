/** Dummy local auth for the storefront — distinct key from admin/reseller. */

const KEY = 'imc_shopper_session';

export function isSignedIn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export function signIn(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}
export function signOut(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
