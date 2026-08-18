import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';

export interface AccessTokenPayload {
  sub: string; // user id
  role: Role;
  sid: string; // session id (for revocation)
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  // Throws on invalid/expired; caller maps to 401.
  return jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
}
