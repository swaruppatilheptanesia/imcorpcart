import type { Role } from '@prisma/client';

// The authenticated principal attached by the auth middleware.
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  sessionId: string;
}

// The authenticated integration partner attached by requirePartner.
export interface PartnerPrincipal {
  id: string;
  name: string;
  slug: string;
  catalogScope: { categorySlugs?: string[] } | null;
  commissionPct: number | null;
  webhookUrl: string | null;
  features: Record<string, unknown> | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      partner?: PartnerPrincipal;
      rawBody?: string; // raw request body, captured for HMAC signature verification
      id?: string; // request id
    }
  }
}

export {};
