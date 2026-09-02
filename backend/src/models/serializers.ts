import { Prisma } from '@prisma/client';

// Prisma returns money columns as Decimal objects and timestamps as Date.
// This walks a value and converts Decimal -> number and Date -> ISO string so
// every JSON response is plain, front-end-friendly data. It also drops a set of
// never-expose keys (hashes, secrets, secret refs) defensively, in case a raw
// record is passed through without an explicit `select`.

const SECRET_KEYS = new Set([
  'passwordHash',
  'codeHash',
  'tokenHash',
  'secret',
  'recoveryCode',
  'keyRef',
  'webhookRef',
  'apiKeyRef',
  'apiSecretEnc',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

export function serialize<T>(value: T): T {
  if (value === null || value === undefined) return value;

  if (value instanceof Prisma.Decimal) {
    return value.toNumber() as unknown as T;
  }
  if (value instanceof Date) {
    return value.toISOString() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => serialize(v)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEYS.has(k)) continue;
      out[k] = serialize(v);
    }
    return out as T;
  }
  return value;
}

// Convenience for turning a Decimal (or Decimal-like) into a number safely.
export function toNumber(d: Prisma.Decimal | number | null | undefined): number {
  if (d === null || d === undefined) return 0;
  return typeof d === 'number' ? d : d.toNumber();
}
