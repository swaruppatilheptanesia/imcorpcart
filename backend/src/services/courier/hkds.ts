import { randomUUID } from 'crypto';
import { CourierCode, ShipmentStatus } from '@prisma/client';
import { env } from '../../config/env';

// H.K. Data Services courier aggregator (goldmedal.hkdataservices.com).
//
// Endpoints: AWB tracking (GET, eight carriers), AWB generation (POST, DTDC
// only), and the carrier documents added in the Oct 2026 collection — proof of
// delivery for DTDC (PDF) and BlueDart (JPEG), and the Delhivery B2B LR copy. Both are optional helpers — fulfilment works without them — so
// nothing here throws. Every call returns a discriminated result and the caller
// is forced to handle the fallback branch, which is the manual AWB entry and
// manual transit update that have always existed.
//
// Observed quirks this client is built around (verified against the live API):
//   • An unknown AWB, an expired AWB and an UNSUPPORTED CARRIER all return
//     `200 []` — indistinguishable from each other. `[]` therefore means "no
//     update", never "delivered" and never an error.
//   • An invalid API key returns **404 with a plain-text body** ("Invalid API
//     Key") on every endpoint. But the POD endpoints ALSO answer 404 (an IIS
//     HTML page) when the carrier simply has no file yet — so a 404 is AUTH only
//     when the body says so, and is otherwise "not available yet".
//   • DTDC's POD answers `400 {"code":"WRONG_INPUT","message":"No CN To print
//     whose status is delivered"}` for an unknown or undelivered AWB, and the
//     Delhivery B2B LR copy `400 {"success":false,…"Invalid LRNs"}` — both are
//     "not available", not faults.
// The transport is plain http:// and the key travels in the query string.

const DEFAULT_BASE = 'http://goldmedal.hkdataservices.com';
// Some carriers are slow behind the aggregator (Gati took ~21s in testing), and
// every call runs in the background poller or behind an explicit button.
const TIMEOUT_MS = 30_000;

export function hkdsConfigured(): boolean {
  return env.HKDS_ENABLED && Boolean(env.HKDS_API_KEY);
}

const baseUrl = () => (env.HKDS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');

/**
 * Our courier vocabulary → theirs (the `Transport` names of the Oct 2026
 * collection). EKART and INDIA_POST are deliberately absent because the
 * aggregator does not serve them and answers `200 []`, which would otherwise
 * look like "no update yet" forever.
 */
const CODE_TO_TRANSPORT: Partial<Record<CourierCode, string>> = {
  DTDC: 'DTDC',
  BLUEDART: 'BLUEDART',
  DELHIVERY: 'DELHIVERY',
  GATI: 'GATI',
  CRITICALLOG: 'CRITICALLOG',
  JAYDEEP: 'JAYDEEP',
  MOVIN: 'MOVIN',
  DELHIVERY_B2B: 'DELHIVERYB2B',
};

export function isTrackableCourier(code: CourierCode | null | undefined): boolean {
  return Boolean(code && CODE_TO_TRANSPORT[code]);
}

/** Carriers whose proof of delivery the aggregator returns. */
const POD_PATH: Partial<Record<CourierCode, string>> = {
  DTDC: 'DTDCPod',
  BLUEDART: 'BlueDartPod',
};

export function podSupported(code: CourierCode | null | undefined): boolean {
  return Boolean(code && POD_PATH[code]);
}

/** Delhivery B2B's document is the LR copy — a booking document, never a POD. */
export function lrCopySupported(code: CourierCode | null | undefined): boolean {
  return code === CourierCode.DELHIVERY_B2B;
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
  /** `statusUpdateDate` as an instant, when it is in a format we recognise. */
  occurredAt: Date | null;
  /** The untouched row, stored on ShipmentTrackingEvent.raw. */
  raw: unknown;
}

/** A carrier document fetched as bytes (POD or LR copy). */
export interface HkdsFile {
  buffer: Buffer;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  ext: 'pdf' | 'jpg' | 'png';
}

export interface HkdsAwb {
  awbNo: string;
  /** Shipping label PDF, produced at booking. NOT a proof of delivery. */
  labelUrl: string | null;
  raw: unknown;
}

type Fail = { ok: false; reason: HkdsFailure; detail?: string };

async function send(url: string, init: RequestInit): Promise<{ ok: true; res: Response } | Fail> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'X-Request-Id': randomUUID(), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: true, res };
  } catch (e) {
    return { ok: false, reason: 'TRANSPORT', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Classify a non-2xx answer. Only a 404 whose body says "Invalid API Key" is an
 * auth failure; any other 404 (the POD endpoints' "no file" page) and the
 * vendors' 400 "nothing to print" bodies mean the document isn't there yet.
 */
function classifyError(status: number, body: string): Fail {
  const detail = body.replace(/\s+/g, ' ').slice(0, 200);
  if (/invalid api key/i.test(body)) return { ok: false, reason: 'AUTH', detail: 'Invalid API Key' };
  if (status === 404) return { ok: false, reason: 'NO_DATA', detail };
  if (status === 400 && /WRONG_INPUT|"success"\s*:\s*false|No CN To print|Invalid LRN/i.test(body)) {
    return { ok: false, reason: 'NO_DATA', detail };
  }
  return { ok: false, reason: 'TRANSPORT', detail: `HTTP ${status} ${detail}` };
}

/** Shared fetch for the JSON endpoints: timeout, no throw, text-first parsing. */
async function call(url: string, init: RequestInit): Promise<{ ok: true; status: number; text: string } | Fail> {
  const sent = await send(url, init);
  if (!sent.ok) return sent;
  const text = await sent.res.text().catch(() => '');
  if (!sent.res.ok) return classifyError(sent.res.status, text);
  return { ok: true, status: sent.res.status, text };
}

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** What the bytes actually are — the content-type header alone is not trusted. */
function sniff(buf: Buffer): HkdsFile['ext'] | null {
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}
const EXT_MIME: Record<HkdsFile['ext'], HkdsFile['mimeType']> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };

/** GET a carrier document as bytes. A 200 that is not a PDF/JPEG/PNG is refused. */
async function fetchDocument(endpoint: string, awbNo: string): Promise<HkdsResult<HkdsFile>> {
  if (!hkdsConfigured()) return { ok: false, reason: 'DISABLED' };
  if (!awbNo?.trim()) return { ok: false, reason: 'NO_DATA' };

  const url =
    `${baseUrl()}/api/AWBTracking/${endpoint}` +
    `?AWBNo=${encodeURIComponent(awbNo.trim())}` +
    `&APIKey=${encodeURIComponent(env.HKDS_API_KEY!)}`;
  const sent = await send(url, { method: 'GET' });
  if (!sent.ok) return sent;
  const { res } = sent;
  if (!res.ok) return classifyError(res.status, await res.text().catch(() => ''));

  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'BAD_RESPONSE', detail: `Document too large (${declared} bytes)` };
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { ok: false, reason: 'TRANSPORT', detail: e instanceof Error ? e.message : String(e) };
  }
  if (buffer.length > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'BAD_RESPONSE', detail: `Document too large (${buffer.length} bytes)` };

  const ext = sniff(buffer);
  if (!ext) {
    // DTDC may answer JSON (an error, or a link) with a 200; we cannot file that.
    return { ok: false, reason: 'BAD_RESPONSE', detail: buffer.subarray(0, 200).toString('utf8').replace(/\s+/g, ' ') };
  }
  return { ok: true, data: { buffer, mimeType: EXT_MIME[ext], ext } };
}

/** The carrier's proof of delivery (DTDC PDF, BlueDart JPEG). NO_DATA = not published yet. */
export async function fetchPod(awbNo: string, courier: CourierCode | null | undefined): Promise<HkdsResult<HkdsFile>> {
  const endpoint = courier ? POD_PATH[courier] : undefined;
  if (!endpoint) return { ok: false, reason: 'UNSUPPORTED_COURIER', detail: courier ?? 'no courier set' };
  return fetchDocument(endpoint, awbNo);
}

/** Delhivery B2B LR copy for an LR number. Not a proof of delivery. */
export function fetchLrCopy(lrNo: string): Promise<HkdsResult<HkdsFile>> {
  return fetchDocument('DelhiveryB2BPod', lrNo);
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
      occurredAt: parseCarrierDate(str(r.statusUpdateDate)),
      raw: r,
    },
  };
}

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/**
 * A carrier timestamp → Date, read as IST wall-clock time. The vendor has not
 * documented the format, so only shapes we can read unambiguously are accepted
 * (ISO, `dd-MMM-yyyy[ hh:mm[:ss] AM]`, `dd/mm/yyyy[ hh:mm[:ss]]`); anything else
 * is null and the caller uses "now".
 */
export function parseCarrierDate(raw: string | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}+05:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = /\d/.test(m[2]) ? Number(m[2]) - 1 : MONTHS[m[2].toUpperCase()];
  if (month === undefined || month < 0 || month > 11 || day < 1 || day > 31) return null;
  let hour = m[4] ? Number(m[4]) : 0;
  if (m[7]) hour = (hour % 12) + (/p/i.test(m[7]) ? 12 : 0);
  const utc = Date.UTC(Number(m[3]), month, day, hour, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0) - 330 * 60_000;
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d;
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

// ─── Carrier status → ShipmentStatus ─────────────────────────────────────────
//
// The client's status matcher (Shipment_Status_Matcher.xlsx, Oct 2026) buckets
// each carrier's status texts into five columns, which map one-to-one onto our
// ShipmentStatus:
//
//   In Transit → IN_TRANSIT · Out for Delivery → OUT_FOR_DELIVERY ·
//   Shipment Delivered → DELIVERED · RTO (Return to Origin) → RETURNED ·
//   Issue → FAILED (order status untouched; tracking carries on, so a later
//   "Out for Delivery" or "Delivered" moves it on again)
//
// Those texts are matched EXACTLY (after normalising case and punctuation),
// per carrier first, then across all carriers. Only a text the sheet does not
// list falls through to the keyword rules below.

const { IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, RETURNED, FAILED } = ShipmentStatus;

/** "Out Delivery – Call Placed" → "OUT DELIVERY CALL PLACED". */
const normaliseStatus = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * Identity of one courier answer: the status text plus the courier's own
 * timestamp. The same answer polled again has the same fingerprint, so it is
 * recorded once; the same text at a later scan ("In Transit" at the next hub)
 * has a new timestamp and is a new entry. Without a timestamp, text alone.
 */
export function courierFingerprint(status: unknown, statusUpdateDate: unknown): string {
  const text = typeof status === 'string' ? normaliseStatus(status) : '';
  const when = typeof statusUpdateDate === 'string' ? statusUpdateDate.trim() : '';
  return `${text}|${when}`;
}

const STATUS_SHEET: Partial<Record<CourierCode, Record<ShipmentStatus, string[]>>> = {
  BLUEDART: {
    IN_TRANSIT: [
      'In Transit',
      'Shipment Arrived at Facility',
      'Shipment Returned to Facility', // a hub transfer, NOT a return to the shipper
      'Delay Beyond Our Control',
      'Delivery Scheduled Through Appointment',
      'Paper Work Inscan',
      'Shipment Arrived',
      'Network Delay',
      'Will Impact Delivery',
      'Shipment Further Connected',
    ],
    OUT_FOR_DELIVERY: ['Out for Delivery', 'Shipment Out For Delivery'],
    DELIVERED: ['Delivered', 'Shipment Delivered'],
    RETURNED: ['RTO (Return to Origin)', "Returned To Origin At Shipper's Request", 'RTO Delivered'],
    FAILED: [
      'Held at Location',
      'Undelivered',
      'Consignee Not Available',
      'Address Incomplete',
      'On Hold',
      'Network Issue',
      'Contact Customer Care',
      'Consignee Refused To Accept',
      'Delivery Attempted',
    ],
    PENDING: [],
    DISPATCHED: [],
  },
  DELHIVERY: {
    IN_TRANSIT: ['In Transit', 'Bagged', 'Connected to Destination', 'Received at Facility', 'Picked Up'],
    OUT_FOR_DELIVERY: ['Out for Delivery', 'Out Delivery – Call Placed'],
    DELIVERED: ['Delivered', 'OTP Verified'],
    RETURNED: ['RTO Initiated', 'RTO Delivered'],
    FAILED: [
      'Delivery Attempted',
      'Exception - Damaged',
      'Exception - Lost in Transit',
      'Delayed Due to Weather',
      'Customer Rescheduled',
      'Lost',
    ],
    PENDING: [],
    DISPATCHED: [],
  },
  DTDC: {
    IN_TRANSIT: ['In Transit', 'Arrived at Transit Location', 'Forwarded to Delivery Branch'],
    OUT_FOR_DELIVERY: ['Out for Delivery'],
    DELIVERED: ['Delivered'],
    RETURNED: ['RTO in Transit', 'RTO Delivered'],
    FAILED: [
      'Delivery Attempted',
      'Undelivered',
      'Held Due to Address Issue',
      'Damaged in Transit',
      'Lost in Transit',
      'Refused by Consignee',
    ],
    PENDING: [],
    DISPATCHED: [],
  },
};
// Delhivery B2B is the same carrier's freight arm; until it has its own column,
// read its texts with Delhivery's.
STATUS_SHEET.DELHIVERY_B2B = STATUS_SHEET.DELHIVERY;

type StatusIndex = Map<string, ShipmentStatus>;
const indexOf = (sheet: Record<ShipmentStatus, string[]>): StatusIndex => {
  const m: StatusIndex = new Map();
  for (const [status, texts] of Object.entries(sheet) as [ShipmentStatus, string[]][]) {
    for (const t of texts) m.set(normaliseStatus(t), status);
  }
  return m;
};
const SHEET_BY_COURIER = new Map(
  (Object.entries(STATUS_SHEET) as [CourierCode, Record<ShipmentStatus, string[]>][]).map(([c, sh]) => [c, indexOf(sh)]),
);
// Every carrier's texts in one index, for carriers the sheet does not cover
// (Gati, CriticalLog, …). The three carriers never disagree on a shared text.
const SHEET_ANY: StatusIndex = new Map(
  [...SHEET_BY_COURIER.values()].flatMap((m) => [...m.entries()]),
);

/**
 * Carrier status text → our ShipmentStatus.
 *
 * 1. The client's matcher sheet, exact, for this carrier — then for any carrier.
 * 2. Keyword rules for texts the sheet does not list, ordered so a problem or a
 *    return always beats the words "transit" and "delivery" it usually contains
 *    ("Damaged in Transit" is an issue; "Returned to Facility" is not a return).
 * 3. Otherwise null, which callers MUST treat as "leave the order alone" — the
 *    raw text is stored on ShipmentTrackingEvent.raw so the sheet can grow.
 */
export function mapTrackingStatus(raw: string, courier?: CourierCode | null): ShipmentStatus | null {
  const s = normaliseStatus(raw);
  if (!s) return null;

  const exact = (courier ? SHEET_BY_COURIER.get(courier)?.get(s) : undefined) ?? SHEET_ANY.get(s);
  if (exact) return exact;

  if (/\bRTO\b|RETURN(ED)? TO (ORIGIN|SHIPPER)/.test(s)) return RETURNED;
  if (
    /UNDELIVERED|NOT DELIVERED|DELIVERY FAILED|ATTEMPT|EXCEPTION|CANCELLED|\bHELD\b|\bHOLD\b|REFUSED|\bLOST\b|DAMAGED|NOT AVAILABLE|ADDRESS|RESCHEDULED|CUSTOMER CARE/.test(s)
  ) {
    return FAILED;
  }
  if (/DELIVERED|OTP VERIFIED/.test(s)) return DELIVERED;
  if (/OUT FOR DELIVERY|OUT FOR DELY|OUT DELIVERY/.test(s)) return OUT_FOR_DELIVERY;
  if (/IN TRANSIT|TRANSIT|DEPARTED|ARRIVED|BAGGED|RECEIVED AT|CONNECTED|FORWARDED|INSCAN|PICKED|RETURNED TO FACILITY|DELAY/.test(s)) {
    return IN_TRANSIT;
  }
  if (/PICKUP|SHIPMENT BOOKED|BOOKED|MANIFEST|DISPATCH/.test(s)) return ShipmentStatus.DISPATCHED;
  return null;
}
