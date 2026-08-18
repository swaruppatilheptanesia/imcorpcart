import { PrismaClient } from '@prisma/client';
import { env } from './env';

// Single shared PrismaClient for the whole process. Importing this module
// anywhere reuses the same connection pool.
export const prisma = new PrismaClient({
  log: env.isProd ? ['warn', 'error'] : ['warn', 'error'],
});

export async function connectPrisma(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
