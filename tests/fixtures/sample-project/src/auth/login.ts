import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function loginUser(email: string, _password: string) {
  return prisma.user.findUnique({ where: { email } });
}
