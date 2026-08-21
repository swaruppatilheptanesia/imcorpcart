import { Role, RegistrationSource } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { OTP_PURPOSE } from '../config/constants';
import { AppError } from '../utils/AppError';
import { signAccessToken } from '../utils/jwt';
import { generateOtp, hashOtp, verifyOtp } from '../utils/otp';
import { sendOtpEmail } from './mailer.service';
import { isFreeMailDomain } from '../utils/freemail';
import { userSafeSelect } from '../models/selectors';
import { serialize } from '../models/serializers';
import type { RegisterInput } from '../validators/auth.schema';

// The challenge token returned by /login is just the OtpToken id — the client
// echoes it back to /verify-otp along with the code the user received.
export interface LoginResult {
  challengeToken: string;
  // Dev convenience: surface the OTP so the flow is testable without email/SMS.
  devOtp?: string;
  message: string;
}

export interface SessionResult {
  accessToken: string;
  user: unknown;
}

// Self-registration outcome when the account needs Super Admin activation before
// it can sign in — no session or OTP is issued.
export interface PendingResult {
  pending: true;
  message: string;
}

export interface AuthContext {
  ip?: string;
  userAgent?: string;
}

// Passwordless login: resolve the account by email, run the same status/company
// gates as before, then email a one-time code. There is no password — the OTP is
// the only factor. Login never auto-creates accounts (see register()).
const OTP_COOLDOWN_MS = 30_000;
const otpCooldown = new Map<string, number>(); // lowercased email -> last-send epoch ms

export async function login(email: string): Promise<LoginResult | SessionResult> {
  const normalized = email.toLowerCase();
  const user = await prisma.user.findFirst({
    where: { email: normalized, deletedAt: null },
  });

  if (!user) throw AppError.notFound('No account found for this email');
  if (user.status === 'PENDING') {
    throw new AppError(
      403,
      'ACCOUNT_PENDING',
      'Your login is pending administrator approval. Please try again once your account has been activated.',
    );
  }
  if (user.status === 'DISABLED' || user.status === 'SUSPENDED') {
    throw AppError.forbidden('Account is not active');
  }

  // Company-level approval gate: no user may sign in until a Super Admin has
  // approved (activated) their company. Resolved via the employee relation or
  // the company admin link — Super Admins / resellers have no company row and
  // pass through. Checked before any OTP is issued (so the code is never emailed
  // for a non-approved company).
  const company = await prisma.company.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { adminUserId: user.id },
        { employees: { some: { userId: user.id, deletedAt: null } } },
      ],
    },
    select: { status: true },
  });
  if (company && company.status !== 'ACTIVE') {
    if (company.status === 'ONBOARDING')
      throw new AppError(
        403,
        'COMPANY_PENDING',
        'Your company is pending administrator approval. You can sign in once it has been approved.',
      );
    throw AppError.forbidden('Your company account is not active. Please contact support.');
  }

  // Direct sign-in for allow-listed demo accounts (OTP_BYPASS_EMAILS) — e.g. the
  // seeded Super Admin, whose fake domain can't receive a real email. Everyone
  // else goes through the emailed OTP below.
  if (env.otpBypassEmails.has(normalized)) {
    return issueSession(user);
  }

  // Per-email cooldown to prevent email-bombing (the IP-level authLimiter is the
  // other guard). A legitimate resend just waits out the short window.
  const last = otpCooldown.get(normalized);
  if (last && Date.now() - last < OTP_COOLDOWN_MS) {
    throw new AppError(
      429,
      'OTP_COOLDOWN',
      'A sign-in code was just sent. Please wait a moment before requesting another.',
    );
  }
  otpCooldown.set(normalized, Date.now());

  return issueLoginOtp(user);
}

// Mint a Session + JWT for a user directly (no OTP). Used only by the
// OTP_BYPASS_EMAILS allow-list in login(); mirrors the tail of verifyLoginOtp.
async function issueSession(
  user: { id: string; role: Role; status: string },
  ctx: AuthContext = {},
): Promise<SessionResult> {
  const sessionTtlHours = 12;
  const [session] = await prisma.$transaction([
    prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `sess_${user.id}_${Date.now()}`,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        expiresAt: new Date(Date.now() + sessionTtlHours * 3600_000),
      },
    }),
    ...(user.status === 'INVITED'
      ? [prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } })]
      : []),
  ]);

  const accessToken = signAccessToken({ sub: user.id, role: user.role, sid: session.id });

  const safeUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: userSafeSelect,
  });

  return { accessToken, user: serialize(safeUser) };
}

// Issue a passwordless-login OTP for a user and return the challenge. Stores only
// the hash; emails the code (best-effort) and, in dev, logs + returns it.
async function issueLoginOtp(user: { id: string; email: string }): Promise<LoginResult> {
  const code = generateOtp();
  const codeHash = await hashOtp(code);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MIN * 60_000);

  const token = await prisma.otpToken.create({
    data: { userId: user.id, codeHash, purpose: OTP_PURPOSE.PASSWORDLESS_LOGIN, expiresAt },
  });

  // Dev convenience: log + return the code so the flow is testable without a real
  // inbox. Email delivery is best-effort and never blocks sign-in.
  // eslint-disable-next-line no-console
  console.log(`[auth] OTP for ${user.email}: ${code} (expires ${expiresAt.toISOString()})`);
  await sendOtpEmail(user.email, code, env.OTP_TTL_MIN);

  return {
    challengeToken: token.id,
    devOtp: env.isProd ? undefined : code,
    message: 'We emailed you a 6-digit sign-in code. Enter it to continue.',
  };
}

// Turn a corporate email domain into a readable company name ("acme.com" → "Acme").
function companyNameFromDomain(domain: string): string {
  const base = (domain.split('.')[0] ?? domain).replace(/[-_]/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : domain;
}

// Employee self-registration. The email domain resolves the company: if none
// exists for that domain, a new ONBOARDING company is created (no admin yet —
// Super Admin grants company-admin rights later). The new account is an
// EMPLOYEE_EPP that starts PENDING and must be activated by a Super Admin.
export async function register(
  input: RegisterInput,
): Promise<LoginResult | SessionResult | PendingResult> {
  const email = input.email.toLowerCase();
  const domain = email.split('@')[1];
  if (!domain) throw AppError.badRequest('A valid work email is required');

  // Personal-email registrants can't be matched to a company by domain — they
  // must supply their company's GSTIN (validated by the zod schema) + name so
  // the Super Admin can contact the company about HR portal access.
  const freeMail = isFreeMailDomain(domain);
  if (freeMail) {
    if (!input.gstin)
      throw AppError.badRequest('A company GSTIN is required when registering with a personal email');
    if (!input.companyName) throw AppError.badRequest('Company name is required');
  }

  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) throw AppError.conflict('An account with this email already exists');

  // Phone is @unique — pre-check so a duplicate surfaces as a clear message
  // rather than a raw P2002. (input.phone is the zod-normalized digits.)
  const phoneTaken = await prisma.user.findFirst({ where: { phone: input.phone } });
  if (phoneTaken) throw AppError.conflict('This phone number is already registered');

  // Exhibition QR attribution: only a live campaign (ACTIVE + in-window) grants
  // the discount; a dead/unknown token falls back to a normal account.
  const now = new Date();
  const campaign = input.qrToken
    ? await prisma.exhibitionCampaign.findFirst({
        where: { qrToken: input.qrToken, status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gte: now } },
      })
    : null;

  await prisma.$transaction(async (tx) => {
    // Free mail: the company is keyed on GSTIN (no email domain). Corporate
    // mail: keyed on the email domain, as before.
    let company = freeMail
      ? await tx.company.findFirst({ where: { gstin: input.gstin } })
      : await tx.company.findFirst({ where: { emailDomain: domain } });
    if (!company) {
      company = await tx.company.create({
        data: freeMail
          ? { name: input.companyName!, gstin: input.gstin, status: 'ONBOARDING' }
          : { name: companyNameFromDomain(domain), emailDomain: domain, status: 'ONBOARDING' },
      });
    }

    const u = await tx.user.create({
      data: {
        email,
        phone: input.phone,
        // Passwordless: accounts have no password; sign-in is email → OTP.
        passwordHash: null,
        fullName: input.fullName,
        role: Role.EMPLOYEE_EPP,
        // Self-registrations start PENDING and cannot sign in until a Super Admin
        // activates them (applies to QR-exhibition sign-ups too).
        status: 'PENDING',
        registrationSource: campaign ? RegistrationSource.QR_EXHIBITION : RegistrationSource.ADMIN,
        qrDiscountEligible: Boolean(campaign),
        qrCampaignId: campaign?.id ?? null,
      },
    });

    await tx.employee.create({
      data: { companyId: company.id, userId: u.id, employeeCode: `EMP-${Date.now()}`, monthlySalary: 0 },
    });

    return u;
  });

  // No session or OTP: the account is PENDING and must be activated by a Super
  // Admin before it can sign in. The frontend shows this message.
  return {
    pending: true,
    message:
      'Thanks for registering! Your account is pending administrator approval. You can sign in once it has been activated.',
  };
}

export async function verifyLoginOtp(
  challengeToken: string,
  code: string,
  ctx: { ip?: string; userAgent?: string },
) {
  const token = await prisma.otpToken.findUnique({
    where: { id: challengeToken },
    include: { user: true },
  });

  const validPurpose =
    token?.purpose === OTP_PURPOSE.PASSWORDLESS_LOGIN || token?.purpose === OTP_PURPOSE.LOGIN_2FA;
  if (!token || token.consumed || !validPurpose) {
    throw AppError.unauthorized('Invalid or used verification token');
  }
  if (token.expiresAt < new Date()) {
    throw AppError.unauthorized('Verification code has expired');
  }

  const ok = await verifyOtp(code, token.codeHash);
  if (!ok) throw AppError.unauthorized('Incorrect verification code');

  const user = token.user;
  if (!user || user.deletedAt) throw AppError.unauthorized('Account not found');

  // Consume the OTP, open a session, activate an invited account — atomically.
  const sessionTtlHours = 12;
  const [session] = await prisma.$transaction([
    prisma.session.create({
      data: {
        userId: user.id,
        // tokenHash must be unique; the JWT itself carries auth, this is a session record.
        tokenHash: `sess_${token.id}_${Date.now()}`,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        expiresAt: new Date(Date.now() + sessionTtlHours * 3600_000),
      },
    }),
    prisma.otpToken.update({ where: { id: token.id }, data: { consumed: true } }),
    ...(user.status === 'INVITED'
      ? [prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } })]
      : []),
  ]);

  const accessToken = signAccessToken({ sub: user.id, role: user.role, sid: session.id });

  const safeUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: userSafeSelect,
  });

  return { accessToken, user: serialize(safeUser) };
}

export async function logout(sessionId: string): Promise<void> {
  await prisma.session.updateMany({ where: { id: sessionId }, data: { revoked: true } });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: userSafeSelect,
  });
  if (!user) throw AppError.notFound('User not found');
  return serialize(user);
}
