import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['error'], // Solo errores, sin queries
});

export default prisma;
