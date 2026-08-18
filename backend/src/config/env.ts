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

  // 2FA toggle. When 'false', password login/registration signs the user in
  // directly (no OTP challenge) — used to hide 2FA for client beta testing.
  // Defaults to enabled; z.coerce.boolean would treat "false" as true, so parse
  // the literal string instead.
  OTP_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // Master checkout switch. 'false' = browse/register only: the order-creation
  // endpoints 403 and the storefront hides every pay/checkout entry point. Set
  // 'true' (with live Razorpay keys) to open ordering. Same string-literal parse
  // as OTP_ENABLED so "false" isn't coerced to true.
  CHECKOUT_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // Razorpay checkout. Optional so the app can boot without payments configured;
  // the payment endpoints return a clear error when the keys are absent.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  // Optional saved Checkout Configuration id (dashboard → Payment methods config,
  // e.g. "config_XXXX") — restricts/orders the methods shown in the modal.
  RAZORPAY_CHECKOUT_CONFIG_ID: z.string().optional(),
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
};

export type Env = typeof env;
