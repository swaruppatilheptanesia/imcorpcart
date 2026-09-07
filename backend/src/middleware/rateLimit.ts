import rateLimit from 'express-rate-limit';

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
  keyGenerator: (req) => (req.header('x-api-key') || req.ip) ?? 'unknown',
  message: { error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' } },
});
