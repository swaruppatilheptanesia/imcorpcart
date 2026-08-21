import { z } from 'zod';

// Passwordless login: email only. The server emails a one-time code that the
// client exchanges at /verify-otp.
export const loginBody = z.object({
  email: z.string().email(),
});

export const verifyOtpBody = z.object({
  challengeToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

// Employee self-registration. A corporate email resolves (or creates) the
// employee's company by domain; a free/personal email (gmail, yahoo, …) must
// instead supply the company's GSTIN + name (enforced in the service).
export const registerBody = z.object({
  fullName: z.string().trim().min(1),
  email: z.string().email(),
  // Mandatory Indian 10-digit mobile. Strip spaces/dashes/() then require an
  // optional +91/0 prefix followed by a 6–9 leading digit + 9 more digits.
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s\-()]/g, ''))
    .pipe(
      z.string().regex(/^(\+91|0)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
    ),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')
    .optional(),
  companyName: z.string().trim().min(1).max(120).optional(),
  // Present when the user reached registration by scanning an exhibition
  // campaign QR (?qr=<token>). Invalid/expired tokens register normally.
  qrToken: z.string().trim().min(1).max(64).optional(),
});

export type LoginInput = z.infer<typeof loginBody>;
export type VerifyOtpInput = z.infer<typeof verifyOtpBody>;
export type RegisterInput = z.infer<typeof registerBody>;
