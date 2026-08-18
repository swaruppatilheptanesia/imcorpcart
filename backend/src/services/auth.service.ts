import { Role, RegistrationSource } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { OTP_PURPOSE } from '../config/constants';
import { AppError } from '../utils/AppError';
import { verifyPassword, hashPassword } from '../utils/password';
import { signAccessToken } from '../utils/jwt';
import { generateOtp, hashOtp, verifyOtp } from '../utils/otp';
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

export async function login(
  email: string,
  password: string,
  ctx: AuthContext = {},
): Promise<LoginResult | SessionResult> {
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), deletedAt: null },
  });

  // Uniform error to avoid leaking which accounts exist.
  const invalid = AppError.unauthorized('Invalid email or password');
  if (!user || !user.passwordHash) throw invalid;
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

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw invalid;

  // Beta convenience: when 2FA is disabled, sign the user in directly.
  if (!env.OTP_ENABLED) return issueSession(user, ctx);
  return issueLoginOtp(user);
}

// Mint a Session + JWT for an already-authenticated user. This mirrors the tail
// of verifyLoginOtp (kept separate so the OTP path stays atomic and untouched);
// used by the beta OTP-bypass in login/register.
async function issueSession(
  user: { id: string; role: Role; status: string },
  ctx: AuthContext,
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

// Issue an OTP (second factor) for a user and return the challenge. Shared by
// password login and self-registration. Stores only the hash.
async function issueLoginOtp(user: { id: string; email: string }): Promise<LoginResult> {
  const code = generateOtp();
  const codeHash = await hashOtp(code);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MIN * 60_000);

  const token = await prisma.otpToken.create({
    data: { userId: user.id, codeHash, purpose: OTP_PURPOSE.LOGIN_2FA, expiresAt },
  });

  // In production the code goes out via the notification bus; here we log + return it.
  // eslint-disable-next-line no-console
  console.log(`[auth] OTP for ${user.email}: ${code} (expires ${expiresAt.toISOString()})`);

  return {
    challengeToken: token.id,
    devOtp: env.isProd ? undefined : code,
    message: 'OTP sent. Verify to complete sign-in.',
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

  const passwordHash = await hashPassword(input.password);

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
        passwordHash,
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

  if (!token || token.consumed || token.purpose !== OTP_PURPOSE.LOGIN_2FA) {
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
