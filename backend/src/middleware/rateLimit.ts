import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Brute-force guard for the auth endpoints (login / verify-otp).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
});

// Throughput guard for the partner integration API, keyed per API key (falls back
// to IP when the key header is absent).
export const partnerLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  // Key per API key; fall back to the caller IP. Use the ipKeyGenerator helper so
  // IPv6 addresses are normalized to a subnet (a raw req.ip lets IPv6 callers
  // rotate addresses to bypass the limit — express-rate-limit warns otherwise).
  keyGenerator: (req) => req.header('x-api-key') || ipKeyGenerator(req.ip ?? 'unknown'),
  message: { error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' } },
});
