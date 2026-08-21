import { Resend } from 'resend';
import { env } from '../config/env';

// Lazy Resend singleton — the API key is optional at boot (like Razorpay), so we
// only construct the client when a key is present. When it's absent the mailer is
// a no-op and the caller falls back to the console/devOtp path (dev testing).
let instance: Resend | null = null;

export function mailerConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

function getResend(): Resend | null {
  if (!mailerConfigured()) return null;
  if (!instance) instance = new Resend(env.RESEND_API_KEY!);
  return instance;
}

function otpEmail(code: string, expiresMin: number): { subject: string; html: string; text: string } {
  const subject = `${code} is your imcorpcart sign-in code`;
  const text = `Your imcorpcart sign-in code is ${code}. It expires in ${expiresMin} minutes. If you didn't request this, you can ignore this email.`;
  const html = `
  <div style="margin:0;padding:24px;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
    <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e5ea;">
      <div style="padding:28px 32px 8px;">
        <div style="font-size:15px;font-weight:700;letter-spacing:-0.01em;">imcorpcart</div>
      </div>
      <div style="padding:8px 32px 32px;">
        <div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;margin:8px 0 6px;">Your sign-in code</div>
        <p style="font-size:14px;line-height:1.6;color:#6e6e73;margin:0 0 20px;">Enter this code to finish signing in. It expires in ${expiresMin} minutes.</p>
        <div style="font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;padding:18px 0;background:#f5f5f7;border-radius:12px;color:#1d1d1f;">${code}</div>
        <p style="font-size:12.5px;line-height:1.6;color:#8e8e93;margin:20px 0 0;">If you didn't try to sign in, you can safely ignore this email.</p>
      </div>
    </div>
  </div>`;
  return { subject, html, text };
}

// Best-effort delivery of a login code. Never throws into the auth flow — a send
// failure (missing key, invalid recipient domain, transient Resend error) is
// logged and swallowed so the dev console/devOtp path still works.
export async function sendOtpEmail(to: string, code: string, expiresMin: number): Promise<void> {
  const resend = getResend();
  if (!resend) {
    // eslint-disable-next-line no-console
    console.log(`[mailer] RESEND_API_KEY not set — skipping email to ${to}`);
    return;
  }
  const { subject, html, text } = otpEmail(code, expiresMin);
  try {
    const { error } = await resend.emails.send({ from: env.RESEND_FROM, to, subject, html, text });
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`[mailer] Resend rejected email to ${to}:`, error);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[mailer] Failed to send email to ${to}:`, e instanceof Error ? e.message : e);
  }
}
