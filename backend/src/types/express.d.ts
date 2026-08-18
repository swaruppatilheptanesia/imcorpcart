import type { Role } from '@prisma/client';

// The authenticated principal attached by the auth middleware.
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      id?: string; // request id
    }
  }
}

export {};
