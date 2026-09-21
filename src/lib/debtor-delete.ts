import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

// Same ceiling used elsewhere for chunked bulk operations — Postgres rejects a single
// query with more than ~32,767 bind parameters in one IN (...) clause.
const CHUNK_SIZE = 5000;

/**
 * Deletes the given debtors and everything tied to them (call logs, assignments,
 * reconciliation entries), in dependency order, chunked to stay under Postgres's
 * bind-parameter limit — within a caller-supplied transaction, so it can be composed
 * with other writes (e.g. deleting the File itself) that must succeed or fail together.
 */
async function chunkedDeleteDebtors(tx: Prisma.TransactionClient, debtorIds: string[]): Promise<void> {
  const chunks: string[][] = [];
  for (let i = 0; i < debtorIds.length; i += CHUNK_SIZE) chunks.push(debtorIds.slice(i, i + CHUNK_SIZE));

  for (const chunk of chunks) {
    await tx.reconciliationEntry.deleteMany({ where: { debtorId: { in: chunk } } });
    await tx.assignment.deleteMany({ where: { debtorId: { in: chunk } } });
    // Must run before debtor.deleteMany — CallLog.debtorId has no cascade, so a debtor
    // with logged calls would otherwise fail to delete on the foreign key.
    await tx.callLog.deleteMany({ where: { debtorId: { in: chunk } } });
    await tx.debtor.deleteMany({ where: { id: { in: chunk } } });
  }
}

/**
 * Permanently deletes the given debtors in their own transaction — the standalone form
 * for a caller (the insourced-accounts bulk-remove route) with no other writes to make
 * atomic alongside it. A caller that does need atomicity with other writes (e.g.
 * DELETE /api/files/[id], which also deletes the File row) should open its own
 * `prisma.$transaction` and call `chunkedDeleteDebtors` directly instead — see that
 * route for the pattern.
 */
export async function deleteDebtorsByIds(debtorIds: string[]): Promise<void> {
  if (debtorIds.length === 0) return;

  // Interactive transaction (not the array/batch form) so a 120s timeout can be set —
  // see files/[id]/route.ts and bulk-reassign/route.ts for the same reasoning.
  await prisma.$transaction((tx) => chunkedDeleteDebtors(tx, debtorIds), { timeout: 120_000 });
}

export { chunkedDeleteDebtors };
