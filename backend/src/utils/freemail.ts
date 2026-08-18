// Free/personal email providers. Self-registration with one of these domains
// cannot resolve a company by email domain, so the registrant must supply
// their company's GSTIN instead (see auth.service register()).
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.in',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'zohomail.in',
  'rediffmail.com',
  'yandex.com',
  'gmx.com',
  'mail.com',
]);

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}
