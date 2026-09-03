import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '../config/env';
import { AppError } from './AppError';

// Secret handling for partner integration credentials. The inbound API token is
// stored one-way SHA-256-hashed (looked up by hash, never recoverable). The
// webhook secret must be recoverable — we send it on outbound webhooks for the
// partner to verify — so it is AES-256-GCM encrypted at rest with a master key
// from the environment.

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

/** The partner's single API token — the bearer credential (shown once). */
export function generateApiToken(): string {
  return `imcsk_${randomBytes(32).toString('base64url')}`;
}

/** The partner's webhook signing secret (shown once at creation/rotation). */
export function generateWebhookSecret(): string {
  return `imcwh_${randomBytes(32).toString('base64url')}`;
}

/** SHA-256 hex of an API token — the value we store and look up by. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
