/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let prismaInstance: any = null;

try {
  const prismaModule = require('@prisma/client');
  const PrismaCtor = prismaModule?.PrismaClient;
  if (typeof PrismaCtor === 'function') {
    prismaInstance = new PrismaCtor();
  }
} catch {
  prismaInstance = null;
}

export const prisma = prismaInstance;
