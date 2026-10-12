import { randomUUID } from 'crypto';
import { CourierCode, ShipmentStatus } from '@prisma/client';
import { env } from '../../config/env';

// H.K. Data Services courier aggregator (goldmedal.hkdataservices.com).
//
// Two endpoints: AWB tracking (GET, several carriers) and AWB generation (POST,
// DTDC only). Both are optional helpers — fulfilment works without them — so
// nothing here throws. Every call returns a discriminated result and the caller
// is forced to handle the fallback branch, which is the manual AWB entry and
// manual transit update that have always existed.
//
// Observed quirks this client is built around (verified against the live API):
//   • An unknown AWB, an expired AWB and an UNSUPPORTED CARRIER all return
//     `200 []` — indistinguishable from each other. `[]` therefore means "no
//     update", never "delivered" and never an error.
//   • An invalid API key returns **404 with a plain-text body** ("Invalid API
//     Key"), so 404 is an auth failure, not a missing shipment, and the body
//     must not be fed to res.json().
// The transport is plain http:// and the key travels in the query string.

const DEFAULT_BASE = 'http://goldmedal.hkdataservices.com';
const TIMEOUT_MS = 15_000;

export function hkdsConfigured(): boolean {
  return env.HKDS_ENABLED && Boolean(env.HKDS_API_KEY);
}

const baseUrl = () => (env.HKDS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');

/**
 * Our courier vocabulary → theirs. Only the overlap is listed: EKART and
 * INDIA_POST are deliberately absent because the aggregator does not serve them
 * and answers `200 []`, which would otherwise look like "no update yet" forever.
 */
const CODE_TO_TRANSPORT: Partial<Record<CourierCode, string>> = {
  DTDC: 'DTDC',
  BLUEDART: 'Bluedart',
  DELHIVERY: 'Delhivery',
};

export function isTrackableCourier(code: CourierCode | null | undefined): boolean {
  return Boolean(code && CODE_TO_TRANSPORT[code]);
}

/** Why a call produced no usable result. Only TRANSPORT and AUTH are faults. */
export type HkdsFailure =
  | 'DISABLED' // not configured / switched off — expected, not an error
  | 'NO_DATA' // the `200 []` case: nothing to report yet
  | 'UNSUPPORTED_COURIER' // we never ask; see CODE_TO_TRANSPORT
  | 'UNSUPPORTED_OPERATION' // e.g. AWB generation for a non-DTDC courier
  | 'AUTH' // bad/expired API key (their 404)
  | 'BAD_RESPONSE' // 2xx we could not parse
  | 'TRANSPORT'; // timeout, network error, 5xx

export type HkdsResult<T> = { ok: true; data: T } | { ok: false; reason: HkdsFailure; detail?: string };

export interface HkdsTracking {
  transporter: string;
  awbNo: string;
  origin: string | null;
  destination: string | null;
  pickupDate: string | null;
  consignee: string | null;
  weight: string | null;
  /** Raw carrier status text, e.g. "SHIPMENT DELIVERED". Vocabulary is open. */
  status: string;
  expectedDelDate: string | null;
  statusUpdateDate: string | null;
  /** The untouched row, stored on ShipmentTrackingEvent.raw. */
  raw: unknown;
}

export interface HkdsAwb {
  awbNo: string;
  /** Shipping label PDF, produced at booking. NOT a proof of delivery. */
  labelUrl: string | null;
  raw: unknown;
}

/** Shared fetch: timeout, no throw, and text-first parsing (404 returns prose). */
async function call(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; status: number; text: string } | { ok: false; reason: HkdsFailure; detail?: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'X-Request-Id': randomUUID(), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, reason: 'TRANSPORT', detail: e instanceof Error ? e.message : String(e) };
  }

  const text = await res.text().catch(() => '');

  // Their 404 means "Invalid API Key", not "not found" — surface it as the
  // misconfiguration it is rather than letting it look like an empty result.
  if (res.status === 404) {
    return { ok: false, reason: 'AUTH', detail: text.slice(0, 200) || 'Invalid API Key' };
  }
  if (!res.ok) {
    return { ok: false, reason: 'TRANSPORT', detail: `HTTP ${res.status} ${text.slice(0, 200)}` };
  }
  return { ok: true, status: res.status, text };
}

function parseRows(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed;
    return parsed && typeof parsed === 'object' ? [parsed] : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};

/** Track one AWB. `[]` → NO_DATA, which callers must treat as "leave as-is". */
export async function trackAwb(awbNo: string, courier: CourierCode | null | undefined): Promise<HkdsResult<HkdsTracking>> {
  if (!hkdsConfigured()) return { ok: false, reason: 'DISABLED' };
  if (!awbNo?.trim()) return { ok: false, reason: 'NO_DATA' };

  const transport = courier ? CODE_TO_TRANSPORT[courier] : undefined;
  // Short-circuit rather than sending a request that would answer `200 []`.
  if (!transport) return { ok: false, reason: 'UNSUPPORTED_COURIER', detail: courier ?? 'no courier set' };

  const url =
    `${baseUrl()}/api/AWBTracking` +
    `?APIKey=${encodeURIComponent(env.HKDS_API_KEY!)}` +
    `&AWBNo=${encodeURIComponent(awbNo.trim())}` +
    `&Transport=${encodeURIComponent(transport)}`;

  const res = await call(url, { method: 'GET' });
  if (!res.ok) return res;

  const rows = parseRows(res.text);
  if (rows === null) return { ok: false, reason: 'BAD_RESPONSE', detail: res.text.slice(0, 200) };
  if (rows.length === 0) return { ok: false, reason: 'NO_DATA' };

  const r = rows[rows.length - 1] as Record<string, unknown>;
  const status = str(r.status);
  if (!status) return { ok: false, reason: 'NO_DATA' };

  return {
    ok: true,
    data: {
      transporter: str(r.transporter) ?? transport,
      awbNo: str(r.awbNo) ?? awbNo,
      origin: str(r.origin),
      destination: str(r.destination),
      pickupDate: str(r.pickupDate),
      consignee: str(r.consignee),
      weight: str(r.weight),
      status,
      expectedDelDate: str(r.expectedDelDate),
      statusUpdateDate: str(r.statusUpdateDate),
      raw: r,
    },
  };
}

export interface GenerateAwbInput {
  /** Our order number — sent as CustomerRefNo so their side can dedup. */
  customerRefNo: string;
  customerName: string;
  address1: string;
  address2?: string | null;
  mobileNo: string;
  pincode: string;
  city: string;
  state: string;
  weight?: string;
  courierType?: 'DOCUMENT' | 'NON-DOCUMENT';
  serviceType?: string;
  noOfPieces?: string;
  contentType?: string;
  price?: string;
}

/**
 * Book an AWB. DTDC only — the aggregator supports no other carrier here.
 *
 * Never call this automatically or from a retry loop: it creates a real courier
 * booking, and a timed-out POST may well have succeeded on their side. There is
 * no lookup-by-reference endpoint to recover with (unlike the Hubble client), so
 * the caller must refuse when an AWB already exists and must surface a timeout
 * for a human to confirm instead of retrying.
 */
export async function generateAwb(courier: CourierCode, input: GenerateAwbInput): Promise<HkdsResult<HkdsAwb>> {
  if (!hkdsConfigured()) return { ok: false, reason: 'DISABLED' };
  if (courier !== CourierCode.DTDC) {
    return { ok: false, reason: 'UNSUPPORTED_OPERATION', detail: `AWB generation supports DTDC only (got ${courier})` };
  }

  const url =
    `${baseUrl()}/api/AWBGeneration` +
    `?APIKey=${encodeURIComponent(env.HKDS_API_KEY!)}` +
    `&Courier=DTDC`;

  const res = await call(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      CustomerRefNo: input.customerRefNo,
      CustomerName: input.customerName,
      Address1: input.address1,
      Address2: input.address2 ?? '',
      MobileNo: input.mobileNo,
      pincode: input.pincode,
      city: input.city,
      state: input.state,
      weight: input.weight ?? '1',
      couriertype: input.courierType ?? 'NON-DOCUMENT',
      servicetype: input.serviceType ?? 'PRIORITY',
      Noofpieces: input.noOfPieces ?? '1',
      contenttype: input.contentType ?? 'Goods',
      price: input.price ?? '0',
    }),
  });
  if (!res.ok) return res;

  const rows = parseRows(res.text);
  if (rows === null || rows.length === 0) {
    return { ok: false, reason: 'BAD_RESPONSE', detail: res.text.slice(0, 200) };
  }
  const r = rows[0] as Record<string, unknown>;
  const awbNo = str(r.awbNo);
  // A 2xx without an AWB is not success — treat it as unparseable rather than
  // writing an empty AWB onto the shipment.
  if (!awbNo) return { ok: false, reason: 'BAD_RESPONSE', detail: res.text.slice(0, 200) };

  return { ok: true, data: { awbNo, labelUrl: str(r.label), raw: r } };
}

/**
 * Carrier status text → our ShipmentStatus.
 *
 * The documentation gives exactly one example ("SHIPMENT DELIVERED"), so the
 * real vocabulary is unknown and this matches on normalised substrings. An
 * unrecognised status returns null, which callers MUST treat as "leave the order
 * alone" — guessing would move an order on the strength of a string we have
 * never seen. The raw text is stored on ShipmentTrackingEvent.raw so the map can
 * be filled in from real traffic.
 */
export function mapTrackingStatus(raw: string): ShipmentStatus | null {
  const s = raw.toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
  if (!s) return null;

  // Order matters: "UNDELIVERED" and "RTO" must lose to nothing but themselves.
  if (/\bRTO\b|RETURN(ED)? TO (ORIGIN|SHIPPER)|\bRETURNED\b/.test(s)) return ShipmentStatus.RETURNED;
  if (/UNDELIVERED|NOT DELIVERED|DELIVERY FAILED|EXCEPTION|CANCELLED/.test(s)) return ShipmentStatus.FAILED;
  if (/DELIVERED/.test(s)) return ShipmentStatus.DELIVERED;
  if (/OUT FOR DELIVERY|OUT FOR DELY/.test(s)) return ShipmentStatus.OUT_FOR_DELIVERY;
  if (/IN TRANSIT|TRANSIT|DEPARTED|ARRIVED|BAGGED|RECEIVED AT/.test(s)) return ShipmentStatus.IN_TRANSIT;
  if (/PICKED|PICKUP|SHIPMENT BOOKED|BOOKED|MANIFEST|DISPATCH/.test(s)) return ShipmentStatus.DISPATCHED;
  return null;
}
