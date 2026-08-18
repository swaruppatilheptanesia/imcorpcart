/** Dummy local auth for the reseller portal — no API, no real token. Distinct
 *  storage key so it never collides with the admin or shopper session. */

const KEY = 'imc_reseller_session';

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
    /* storage unavailable — session just won't persist */
  }
}

export function signOut(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
