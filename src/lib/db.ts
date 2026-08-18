import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaTuned?: boolean };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// SQLite defaults to a rollback journal, which fsyncs on every commit — fine for a
// handful of writes, but a real client file import can be tens of thousands of rows
// in one createMany. WAL mode is the standard fix (persists in the db file itself,
// safe to set every startup) and is also just a better default for a server process
// with concurrent reads happening alongside writes.
if (!globalForPrisma.prismaTuned) {
  globalForPrisma.prismaTuned = true;
  prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => {});
  prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL;').catch(() => {});
}
