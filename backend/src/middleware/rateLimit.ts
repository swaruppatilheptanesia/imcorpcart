import { createHash } from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Brute-force guard for the auth endpoints (login / verify-otp).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
});

// Throughput guard for the partner integration API, keyed per partner token.
//
// This used to read an `x-api-key` header the partner API never sends — it
// authenticates with `Authorization: Bearer` — so every partner fell through to
// IP keying and several behind one gateway shared a single budget. The limiter
// runs before `requirePartner`, so the partner id isn't resolved yet; the token
// itself identifies them, hashed so a secret never becomes a store key.
export const partnerLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  // Fall back to the caller IP for unauthenticated requests. Use the
  // ipKeyGenerator helper so IPv6 addresses are normalized to a subnet (a raw
  // req.ip lets IPv6 callers rotate addresses to bypass the limit —
  // express-rate-limit warns otherwise).
  keyGenerator: (req) => {
    const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (bearer) return `tok:${createHash('sha256').update(bearer).digest('hex')}`;
    return ipKeyGenerator(req.ip ?? 'unknown');
  },
  message: { error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' } },
});
