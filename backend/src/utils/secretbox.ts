import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { env } from '../config/env';
import { AppError } from './AppError';

// Symmetric secret handling for partner integration credentials. Unlike passwords
// (hashed one-way), a partner's HMAC secret must be recoverable — we need the raw
// key both to verify inbound request signatures and to sign outbound webhooks — so
// it is AES-256-GCM encrypted at rest with a master key from the environment.

const ALGO = 'aes-256-gcm';

function masterKey(): Buffer {
  if (!env.PARTNER_SECRET_ENC_KEY) {
    throw AppError.badRequest('PARTNER_SECRET_ENC_KEY is not configured — cannot manage partner secrets');
  }
  // Derive a fixed 32-byte key from whatever length the env value is.
  return createHash('sha256').update(env.PARTNER_SECRET_ENC_KEY).digest();
}

/** Encrypt a raw secret → `base64(iv | authTag | ciphertext)`. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Reverse of encryptSecret. Throws if the ciphertext is tampered/undecryptable. */
export function decryptSecret(enc: string): string {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Public partner id, sent by the partner as the `X-Api-Key` header. */
export function generateApiKey(): string {
  return `imcpk_${randomBytes(18).toString('base64url')}`;
}

/** The partner's signing secret (shown once at creation/rotation). */
export function generateSecret(): string {
  return `imcsk_${randomBytes(32).toString('base64url')}`;
}

/** HMAC-SHA256 of `${timestamp}.${rawBody}` with the partner secret (hex). */
export function signPayload(secret: string, timestamp: string | number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** Timing-safe verification of a provided signature (mirrors the Razorpay check). */
export function verifySignature(secret: string, timestamp: string | number, rawBody: string, provided: string): boolean {
  const expected = signPayload(secret, timestamp, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
