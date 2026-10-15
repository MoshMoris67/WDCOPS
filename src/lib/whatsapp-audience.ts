import { Prisma } from '@prisma/client';
import { prisma } from './db';

// Sentinel for "never called" in the disposition picker — it isn't a real DispositionCode.
export const NO_CALL = 'NONE';

/** A debtor's current disposition is the code on their latest call log (same rule as
 *  computeDebtorStatus), so it's resolved with one lateral join rather than loading logs. */
const latestDisposition = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT c."dispositionCode" FROM "CallLog" c
    WHERE c."debtorId" = d.id ORDER BY c."createdAt" DESC LIMIT 1
  ) l ON true`;

/** How many debtors in the file (or everywhere) sit on each latest disposition. */
export async function dispositionCounts(fileId?: string): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<{ code: string | null; n: bigint }[]>(Prisma.sql`
    SELECT l."dispositionCode" AS code, COUNT(*) AS n
    FROM "Debtor" d ${latestDisposition}
    WHERE ${fileId ? Prisma.sql`d."fileId" = ${fileId}` : Prisma.sql`TRUE`}
    GROUP BY l."dispositionCode"`);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.code ?? NO_CALL] = Number(r.n);
  return out;
}

/** Prisma `where` limiting debtors to a file and, if given, to those whose latest
 *  disposition is one of `dispositions` (NO_CALL = never called). Empty = no restriction. */
export async function audienceWhere(fileId?: string, dispositions: string[] = []): Promise<Prisma.DebtorWhereInput> {
  const base: Prisma.DebtorWhereInput = fileId ? { fileId } : {};
  if (!dispositions.length) return base;

  const codes = dispositions.filter((c) => c !== NO_CALL);
  const includeNever = dispositions.includes(NO_CALL);
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT d.id FROM "Debtor" d ${latestDisposition}
    WHERE ${fileId ? Prisma.sql`d."fileId" = ${fileId}` : Prisma.sql`TRUE`}
      AND (
        ${codes.length ? Prisma.sql`l."dispositionCode" IN (${Prisma.join(codes)})` : Prisma.sql`FALSE`}
        OR ${includeNever ? Prisma.sql`l."dispositionCode" IS NULL` : Prisma.sql`FALSE`}
      )`);
  return { ...base, id: { in: rows.map((r) => r.id) } };
}

export function parseDispositions(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((c): c is string => typeof c === 'string' && /^[A-Z0-9]{1,6}$/.test(c)) : [];
}
