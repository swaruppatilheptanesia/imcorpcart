import type { NextFunction, Request, Response } from 'express';
import { OrgStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { decryptSecret, verifySignature } from '../utils/secretbox';

const MAX_SKEW_SECONDS = 300; // 5-minute replay window

// Normalise an IPv6-mapped IPv4 (::ffff:127.0.0.1 → 127.0.0.1) for allowlist match.
function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

// Best-effort audit of a rejected partner request (never blocks the response).
function auditFail(partnerId: string | undefined, ip: string, reason: string) {
  // actorId is a User FK, so the partner id goes in entityId.
  prisma.auditLog
    .create({ data: { action: 'partner.auth.fail', entityType: 'Partner', entityId: partnerId ?? null, ipAddress: ip, after: { reason } } })
    .catch(() => undefined);
}

// Authenticate an integration partner: API key → IP allowlist → HMAC signature
// (with a replay window). Attaches req.partner. Any failure → 401/403.
export async function requirePartner(req: Request, _res: Response, next: NextFunction) {
  const ip = normalizeIp(req.ip);
  let partnerId: string | undefined;
  try {
    if (!env.PARTNER_API_ENABLED) throw AppError.forbidden('Partner API is disabled');

    const apiKey = req.header('x-api-key');
    if (!apiKey) throw AppError.unauthorized('Missing X-Api-Key');

    const partner = await prisma.partner.findFirst({ where: { apiKey, deletedAt: null } });
    if (!partner) throw AppError.unauthorized('Unknown API key');
    partnerId = partner.id;
    if (!partner.active || partner.status !== OrgStatus.ACTIVE) {
      throw AppError.forbidden('Partner is not active');
    }

    // IP allowlist (empty list = any IP allowed).
    if (partner.ipAllowlist.length > 0 && !partner.ipAllowlist.map(normalizeIp).includes(ip)) {
      throw AppError.forbidden('IP not allowed');
    }

    // HMAC signature over `${timestamp}.${rawBody}`, within the replay window.
    const timestamp = req.header('x-timestamp');
    const signature = req.header('x-signature');
    if (!timestamp || !signature) throw AppError.unauthorized('Missing X-Timestamp or X-Signature');
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SECONDS) {
      throw AppError.unauthorized('Stale or invalid timestamp');
    }
    const secret = decryptSecret(partner.apiSecretEnc);
    if (!verifySignature(secret, timestamp, req.rawBody ?? '', signature)) {
      throw AppError.unauthorized('Signature verification failed');
    }

    req.partner = {
      id: partner.id,
      name: partner.name,
      slug: partner.slug,
      catalogScope: (partner.catalogScope as { categorySlugs?: string[] } | null) ?? null,
      commissionPct: partner.commissionPct ? Number(partner.commissionPct) : null,
      webhookUrl: partner.webhookUrl,
      features: (partner.features as Record<string, unknown> | null) ?? null,
    };
    next();
  } catch (err) {
    if (err instanceof AppError && err.statusCode !== 500) auditFail(partnerId, ip, err.message);
    next(err);
  }
}
