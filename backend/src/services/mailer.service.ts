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

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export interface VoucherEmailData {
  brand: string; // e.g. "Amazon Pay"
  amount: number; // face value ₹
  code?: string | null; // card number
  pin?: string | null; // card pin (when applicable)
  cardType?: string | null;
  redemptionUrl?: string | null;
  expiry?: string | null; // YYYY-MM-DD
  orderNo?: string | null; // for the "view in your account" deep-link
}

// ₹ + en-IN grouping (e.g. 2000 → "2,000") — a tiny local helper so the mailer
// (backend) doesn't depend on the frontend's inr().
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// App base URL for deep-links: the first configured CORS origin, else prod.
function appBase(): string {
  const first = (env.CORS_ORIGIN || '').split(',')[0]?.trim();
  return (first || 'https://imcorp.heptanesia.com').replace(/\/+$/, '');
}

const VOUCHER_ACCENT = '#0a5bd6'; // brand accent (tokens.css --accent) — literal for email

function voucherEmail(d: VoucherEmailData): { subject: string; html: string; text: string } {
  const amount = rupees(d.amount);
  const subject = `Your ${amount} ${d.brand} gift card`;
  const ctaUrl = d.redemptionUrl || (d.orderNo ? `${appBase()}/shop/orders/${encodeURIComponent(d.orderNo)}` : null);
  const ctaLabel = d.redemptionUrl ? 'Redeem your gift card' : 'View in your account';

  const text = [
    `Your ${amount} ${d.brand} gift card is ready.`,
    '',
    d.code ? `Card number: ${d.code}` : '',
    d.pin ? `PIN: ${d.pin}` : '',
    d.expiry ? `Valid till: ${d.expiry}` : '',
    '',
    'Treat these details like cash — anyone with the code can spend it.',
    ctaUrl ? `${ctaLabel}: ${ctaUrl}` : '',
    'You can also view this code any time on your order in the imcorpcart app.',
  ]
    .filter((l) => l !== '')
    .join('\n');

  // Credential block: label stacked above a large monospace value (table-based so
  // it holds up in Outlook — no flex).
  const cred = (label: string, value: string) => `
    <tr><td style="padding:6px 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;border:1px solid #e5e5ea;border-radius:12px;">
        <tr><td style="padding:12px 16px;">
          <div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#8e8e93;">${esc(label)}</div>
          <div style="font-size:20px;font-weight:800;letter-spacing:0.06em;color:#1d1d1f;font-family:ui-monospace,SFMono-Regular,Menlo,'Courier New',monospace;margin-top:3px;word-break:break-all;">${esc(value)}</div>
        </td></tr>
      </table>
    </td></tr>`;

  const html = `
  <div style="margin:0;padding:24px 12px;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
    <table role="presentation" align="center" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e5e5ea;border-radius:18px;overflow:hidden;">
      <!-- Header band -->
      <tr><td style="background:${VOUCHER_ACCENT};padding:22px 32px;">
        <div style="font-size:16px;font-weight:800;letter-spacing:-0.01em;color:#ffffff;">imcorpcart</div>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.72);margin-top:2px;">Gift card</div>
      </td></tr>

      <!-- Hero: brand + amount -->
      <tr><td style="padding:28px 32px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#eef4ff,#f7f9ff);border:1px solid #dbe6fb;border-radius:14px;">
          <tr><td style="padding:20px 22px;">
            <div style="font-size:13px;font-weight:600;color:#4a5568;">${esc(d.brand)}</div>
            <div style="font-size:38px;font-weight:800;letter-spacing:-0.02em;color:#0a2540;margin-top:2px;">${amount}</div>
            <div style="font-size:12.5px;color:#6e6e73;margin-top:4px;">Your gift card is ready 🎉</div>
          </td></tr>
        </table>
      </td></tr>

      <!-- Credentials -->
      <tr><td style="padding:8px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${d.code ? cred('Card number', d.code) : ''}
          ${d.pin ? cred('PIN', d.pin) : ''}
          ${d.expiry ? cred('Valid till', d.expiry) : ''}
        </table>
      </td></tr>

      ${
        ctaUrl
          ? `<!-- CTA -->
      <tr><td style="padding:20px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;"><tr><td align="center" style="border-radius:12px;background:${VOUCHER_ACCENT};">
          <a href="${esc(ctaUrl)}" target="_blank" style="display:block;padding:13px 20px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(ctaLabel)} &rarr;</a>
        </td></tr></table>
      </td></tr>`
          : ''
      }

      <!-- Security note -->
      <tr><td style="padding:18px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fde3c4;border-radius:12px;">
          <tr><td style="padding:12px 14px;font-size:12.5px;line-height:1.55;color:#8a5a12;">
            🔒 Treat these details like cash — anyone with the code can spend it. Don't share it.
          </td></tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:18px 32px 30px;">
        <div style="font-size:12px;line-height:1.6;color:#8e8e93;">You can also view this code any time on your order in the imcorpcart app.</div>
      </td></tr>
    </table>
  </div>`;
  return { subject, html, text };
}

// Best-effort delivery of an issued voucher code. Mirrors sendOtpEmail — never
// throws (the code is also revealed in-app, so a send failure is non-fatal).
export async function sendVoucherEmail(to: string, data: VoucherEmailData): Promise<void> {
  const resend = getResend();
  if (!resend) {
    // eslint-disable-next-line no-console
    console.log(`[mailer] RESEND_API_KEY not set — skipping voucher email to ${to} (${data.brand} ₹${data.amount})`);
    return;
  }
  const { subject, html, text } = voucherEmail(data);
  try {
    const { error } = await resend.emails.send({ from: env.RESEND_FROM, to, subject, html, text });
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`[mailer] Resend rejected voucher email to ${to}:`, error);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[mailer] Failed to send voucher email to ${to}:`, e instanceof Error ? e.message : e);
  }
}
