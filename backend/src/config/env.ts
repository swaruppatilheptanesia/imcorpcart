import 'dotenv/config';
import { z } from 'zod';

// Fail fast at boot if the environment is misconfigured, rather than at the
// first request that needs a missing var.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Comma-separated origins; '*' allows any (dev convenience only).
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 chars'),
  JWT_EXPIRES: z.string().default('12h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  OTP_TTL_MIN: z.coerce.number().int().positive().default(10),

  // Legacy 2FA toggle. Login is now passwordless (email → emailed OTP), which is
  // always OTP-based, so this no longer gates sign-in; retained for compatibility.
  // z.coerce.boolean would treat "false" as true, so parse the literal string.
  OTP_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // Comma-separated emails that skip the email-OTP step and sign in directly.
  // For demo accounts on domains that can't receive real mail (e.g. the seeded
  // Super Admin) — everyone else uses passwordless email-OTP.
  OTP_BYPASS_EMAILS: z.string().default(''),

  // Master checkout switch. 'false' = browse/register only: the order-creation
  // endpoints 403 and the storefront hides every pay/checkout entry point. Set
  // 'true' (with live Razorpay keys) to open ordering. Same string-literal parse
  // as OTP_ENABLED so "false" isn't coerced to true.
  CHECKOUT_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // Resend email (passwordless login codes). Optional so the app boots without
  // it; when absent the OTP is only logged/returned as devOtp (non-prod). From
  // address must be on a Resend-verified domain (imcorpcart.com).
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default('imcorpcart <no-reply@imcorpcart.com>'),

  // Razorpay checkout. Optional so the app can boot without payments configured;
  // the payment endpoints return a clear error when the keys are absent.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  // Optional saved Checkout Configuration id (dashboard → Payment methods config,
  // e.g. "config_XXXX") — restricts/orders the methods shown in the modal.
  RAZORPAY_CHECKOUT_CONFIG_ID: z.string().optional(),

  // Partner integration API (/partner-api/v1). Master switch parsed as a literal
  // string (same reason as CHECKOUT_ENABLED). PARTNER_SECRET_ENC_KEY is the master
  // key used to AES-encrypt each partner's signing secret at rest; optional so the
  // app boots without it, but creating/rotating a partner secret errors clearly
  // when it's absent.
  PARTNER_API_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  PARTNER_SECRET_ENC_KEY: z.string().optional(),

  // Hubble (myhubble.money) gift-card/voucher provider — inbound catalog only.
  // Optional so the app boots without it; the Hubble adapter errors clearly when
  // absent. The secret lives ONLY in .env, never .env.example.
  HUBBLE_CLIENT_ID: z.string().optional(),
  HUBBLE_CLIENT_SECRET: z.string().optional(),
  HUBBLE_BASE_URL: z.string().optional(), // default: staging (see config/hubble.ts)
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  otpBypassEmails: new Set(
    raw.OTP_BYPASS_EMAILS.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  ),
};

export type Env = typeof env;
