import { randomUUID } from 'crypto';
import { env } from './env';
import { AppError } from '../utils/AppError';

// Hubble (myhubble.money) partner API client. Auth is a login exchange
// (clientId/clientSecret → short-lived JWT); we cache the token and re-auth on
// expiry or a 401. We consume the catalog (/products, inbound import) AND, for
// automated voucher fulfilment, the order + wallet APIs: placing an order
// auto-debits the client's Hubble wallet and issues the gift-card code (async —
// PROCESSING → poll → SUCCESS with the credential).

const DEFAULT_BASE = 'https://api.dev.myhubble.money'; // staging

// Registry key of the Hubble inbound adapter (== the auto-provisioned source slug).
// Used to detect a Hubble voucher product/line across services.
export const HUBBLE_ADAPTER = 'hubble';

export function hubbleConfigured(): boolean {
  return Boolean(env.HUBBLE_CLIENT_ID && env.HUBBLE_CLIENT_SECRET);
}

function baseUrl(): string {
  return (env.HUBBLE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

let cached: { token: string; expiresAt: number } | null = null;

async function login(): Promise<string> {
  const res = await fetch(`${baseUrl()}/v1/partners/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: env.HUBBLE_CLIENT_ID, clientSecret: env.HUBBLE_CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`Hubble auth failed → HTTP ${res.status}`);
  const data = (await res.json()) as { token?: string; expiresInSecs?: number };
  if (!data.token) throw new Error('Hubble auth returned no token');
  // Refresh at ~80% of the token's life.
  const ttlMs = (Number(data.expiresInSecs) || 3600) * 1000;
  cached = { token: data.token, expiresAt: Date.now() + ttlMs * 0.8 };
  return data.token;
}

async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  return login();
}

interface HubbleReqOpts {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/**
 * Authenticated Hubble request. Attaches the Bearer token + a per-request UUID
 * (X-REQUEST-ID) + JSON headers, and re-auths once on a 401. Returns parsed JSON.
 */
export async function hubbleRequest<T = unknown>(
  method: string,
  path: string,
  opts: HubbleReqOpts = {},
): Promise<T> {
  if (!hubbleConfigured()) {
    throw AppError.badRequest('Hubble is not configured (HUBBLE_CLIENT_ID / HUBBLE_CLIENT_SECRET)');
  }
  const qs = opts.query
    ? '?' +
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const url = `${baseUrl()}${path}${qs}`;

  const doFetch = async (token: string) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-REQUEST-ID': randomUUID(),
        'Content-Type': 'application/json',
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });

  let res = await doFetch(await getToken());
  if (res.status === 401) {
    cached = null; // token rejected mid-session → re-auth once and retry
    res = await doFetch(await login());
  }
  if (!res.ok) {
    // Surface Hubble's structured error (e.g. E300 INSUFFICIENT_BALANCE) so the
    // fulfilment engine can branch on it, while still failing loudly by default.
    let detail = '';
    let code: string | undefined;
    try {
      const body = (await res.json()) as { code?: string; message?: string; error?: string };
      code = body?.code;
      detail = body?.message || body?.error || '';
    } catch {
      /* non-JSON error body */
    }
    throw new HubbleApiError(
      `Hubble ${method} ${path} → HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
      res.status,
      code,
    );
  }
  return (await res.json()) as T;
}

// ─── Voucher fulfilment: order + wallet ─────────────────────────────────────
// (docs.myhubble.money — /v1/partners/orders + /wallet/balance)

export class HubbleApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'HubbleApiError';
  }
}

/** Hubble's INSUFFICIENT_BALANCE error code (the client's wallet needs a top-up). */
export const HUBBLE_INSUFFICIENT_BALANCE = 'E300';

export type HubbleOrderStatus = 'SUCCESS' | 'FAILED' | 'PROCESSING' | 'CANCELLED' | 'REVERSED';

export interface HubbleVoucher {
  id: string;
  cardNumber?: string | null;
  cardPin?: string | null;
  cardType?: string | null; // CARD_AND_PIN_NO_SECURED | CARD_NUMBER_SECURED | PIN_NO_SECURED
  validTill?: string | null; // YYYY-MM-DD
  amount?: number | null;
}

export interface HubbleOrder {
  id: string;
  status: HubbleOrderStatus;
  vouchers?: HubbleVoucher[] | null;
  failureReason?: string | null;
}

export interface HubblePlaceOrderInput {
  productId: string; // Hubble brand/product id (== our Product.externalRef)
  referenceId: string; // our idempotency key (OrderItem.id; ≤40 chars, globally unique)
  amount: number; // sum of denomination × quantity
  denominationDetails: { denomination: number; quantity: number }[];
  discountAmount?: number;
}

/** Place a Hubble voucher order — auto-debits the client wallet, returns SUCCESS|PROCESSING. */
export function hubblePlaceOrder(input: HubblePlaceOrderInput): Promise<HubbleOrder> {
  return hubbleRequest<HubbleOrder>('POST', '/v1/partners/orders', { body: input });
}

/** Fetch a Hubble order by its Hubble id (poll for PROCESSING → SUCCESS). */
export function hubbleGetOrder(orderId: string): Promise<HubbleOrder> {
  return hubbleRequest<HubbleOrder>('GET', `/v1/partners/orders/${encodeURIComponent(orderId)}`);
}

/** Fetch a Hubble order by our referenceId (used to recover from a timed-out place-order). */
export function hubbleGetOrderByReference(referenceId: string): Promise<HubbleOrder> {
  return hubbleRequest<HubbleOrder>('GET', `/v1/partners/orders/by-reference/${encodeURIComponent(referenceId)}`);
}

/** Ask Hubble to re-deliver the voucher over its own channels (we normally self-deliver via Resend). */
export function hubbleResendDelivery(orderId: string, channels: string[] = ['EMAIL']): Promise<unknown> {
  return hubbleRequest('POST', `/v1/partners/orders/${encodeURIComponent(orderId)}/resend-delivery`, {
    body: { channels },
  });
}

/** Current client wallet balance (an ops aid — the client tops it up offline). */
export function hubbleWalletBalance(): Promise<{ balance: number }> {
  return hubbleRequest<{ balance: number }>('GET', '/v1/partners/wallet/balance');
}
