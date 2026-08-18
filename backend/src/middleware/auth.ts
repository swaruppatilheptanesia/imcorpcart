import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { verifyAccessToken } from '../utils/jwt';
import { AppError } from '../utils/AppError';

// Verify the Bearer JWT, confirm the backing session is still valid, and attach
// the principal to req.user. Any failure -> 401.
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw AppError.unauthorized('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw AppError.unauthorized('Invalid or expired token');
    }

    // Confirm the session hasn't been revoked or expired since the JWT was issued.
    const session = await prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.revoked || session.expiresAt < new Date()) {
      throw AppError.unauthorized('Session is no longer valid');
    }

    const user = await prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: { id: true, email: true, fullName: true, role: true, status: true },
    });
    if (!user || user.status === 'DISABLED' || user.status === 'SUSPENDED') {
      throw AppError.unauthorized('Account is not active');
    }

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      sessionId: session.id,
    };

    // Best-effort activity touch; don't block the request on it.
    prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    next();
  } catch (err) {
    next(err);
  }
}

// Restrict a route to specific roles. Must run after requireAuth.
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(AppError.forbidden(`Requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}
