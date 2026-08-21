import { prisma } from './db';
import type { ReconciliationRow } from './excel';
import { assignByCoverageWeight } from './distribution';
import { agentCoverageWeights } from './coverage';
import { applyAssignment } from './assignment';

export interface ProcessResult {
  updatedCount: number;
  totalUpdated: number;
  unmatchedCount: number;
  newAccountsCount: number;
  status: 'processed' | 'failed';
  errorSummary: string | null;
}

/**
 * Matches each row to a debtor by loan ref (preferred) or phone, within the
 * client's debtors — §7: full recons carry an absolute cumulative-paid figure,
 * partial recons carry an incremental amount paid since the last update.
 *
 * A client can also send new accounts riding along with a reconciliation —
 * e.g. a file of 1500 rows where 1200 match the existing book and 300 are
 * brand new. Any row that doesn't match an existing debtor but carries
 * name/phone/amount-owed is created as a new debtor instead of being logged
 * as an unmatched row, then auto-distributed across whichever agents are
 * already working this client, weighted by how caught-up each one currently
 * is (see lib/coverage.ts) — an agent behind on their existing list gets
 * fewer of the new ones, not none.
 */
export async function processReconciliation(
  reconciliationId: string,
  clientId: string,
  type: 'full' | 'partial',
  rows: ReconciliationRow[]
): Promise<ProcessResult> {
  let updatedCount = 0;
  let totalUpdated = 0;
  let unmatchedCount = 0;
  const newAccountRows: ReconciliationRow[] = [];

  for (const row of rows) {
    const debtor = await prisma.debtor.findFirst({
      where: {
        file: { clientId },
        OR: [
          ...(row.loanRef ? [{ loanRef: row.loanRef }] : []),
          ...(row.phone ? [{ phone1: row.phone }, { phone2: row.phone }] : []),
        ],
      },
    });

    if (!debtor) {
      if (row.name && row.phone && row.amountOwed !== null) {
        newAccountRows.push(row);
      } else {
        unmatchedCount++;
      }
      continue;
    }

    const newCumulativePaid = type === 'full' ? row.amount : debtor.cumulativePaid + row.amount;
    const newBalance = Math.max(0, debtor.amountOwed - newCumulativePaid);
    const paidAmount = Math.max(0, newCumulativePaid - debtor.cumulativePaid);

    await prisma.$transaction([
      prisma.debtor.update({
        where: { id: debtor.id },
        data: { cumulativePaid: newCumulativePaid, balance: newBalance },
      }),
      prisma.reconciliationEntry.create({
        data: {
          reconciliationId,
          debtorId: debtor.id,
          oldBalance: debtor.balance,
          newBalance,
          paidAmount,
        },
      }),
    ]);

    updatedCount++;
    totalUpdated += paidAmount;
  }

  const newAccountsCount = newAccountRows.length > 0
    ? await createAndDistributeNewAccounts(reconciliationId, clientId, newAccountRows, (paid) => { totalUpdated += paid; })
    : 0;

  const status: ProcessResult['status'] = updatedCount === 0 && newAccountsCount === 0 && rows.length > 0 ? 'failed' : 'processed';
  const errorSummary =
    unmatchedCount > 0
      ? `${unmatchedCount} of ${rows.length} record(s) could not be matched to a debtor or added as a new account (missing name/phone/amount owed).`
      : null;

  return { updatedCount, totalUpdated, unmatchedCount, newAccountsCount, status, errorSummary };
}

/**
 * Deletes a reconciliation and reverses the balance changes it made — see
 * api/reconciliations/[id]/route.ts's DELETE handler for the full reasoning. The reversal
 * is exact and order-independent: ReconciliationEntry.paidAmount is always the increment
 * that reconciliation applied to cumulativePaid (true for both partial rows, incremental
 * by definition, and full rows, where processReconciliation above already reduces the
 * absolute figure to a delta before storing it), so subtracting it back out and
 * recomputing balance from the result restores exactly what changed — even if another
 * reconciliation has touched the same debtor since. Never deletes a debtor this
 * reconciliation created as a new account; only reverses its recorded starting payment.
 */
export async function reverseAndDeleteReconciliation(reconciliationId: string): Promise<{ reversedCount: number }> {
  const entries = await prisma.reconciliationEntry.findMany({
    where: { reconciliationId },
    select: { debtorId: true, paidAmount: true },
  });

  if (entries.length === 0) {
    await prisma.reconciliation.delete({ where: { id: reconciliationId } });
    return { reversedCount: 0 };
  }

  const reduceByDebtor = new Map<string, number>();
  for (const e of entries) {
    reduceByDebtor.set(e.debtorId, (reduceByDebtor.get(e.debtorId) ?? 0) + e.paidAmount);
  }

  const debtors = await prisma.debtor.findMany({
    where: { id: { in: [...reduceByDebtor.keys()] } },
    select: { id: true, cumulativePaid: true, amountOwed: true },
  });

  const updates = debtors.map((d) => {
    const reduceBy = reduceByDebtor.get(d.id) ?? 0;
    const newCumulativePaid = Math.max(0, d.cumulativePaid - reduceBy);
    const newBalance = Math.max(0, d.amountOwed - newCumulativePaid);
    return prisma.debtor.update({ where: { id: d.id }, data: { cumulativePaid: newCumulativePaid, balance: newBalance } });
  });

  await prisma.$transaction([
    ...updates,
    prisma.reconciliationEntry.deleteMany({ where: { reconciliationId } }),
    prisma.reconciliation.delete({ where: { id: reconciliationId } }),
  ]);

  return { reversedCount: debtors.length };
}

async function createAndDistributeNewAccounts(
  reconciliationId: string,
  clientId: string,
  newAccountRows: ReconciliationRow[],
  onPaid: (amount: number) => void
): Promise<number> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  const newFile = await prisma.file.create({
    data: {
      clientId,
      batchLabel: `${client.name} — New accounts via reconciliation ${new Date().toISOString().slice(0, 10)}`,
      receivedDate: new Date(),
      isMidMonthTopup: true,
    },
  });

  // createManyAndReturn batches this into one INSERT instead of one per new account —
  // matters just as much here as it does for a fresh file import (see api/files/route.ts).
  const created = await prisma.debtor.createManyAndReturn({
    data: newAccountRows.map((row) => {
      const amountOwed = row.amountOwed!;
      const cumulativePaid = Math.min(row.amount, amountOwed);
      const balance = Math.max(0, amountOwed - cumulativePaid);
      return {
        fileId: newFile.id,
        name: row.name!,
        phone1: row.phone!,
        loanRef: row.loanRef ?? `AUTO-${newFile.id}-${row.rowNumber}`,
        amountOwed,
        cumulativePaid,
        balance,
      };
    }),
  });

  const activeAgentIds = await prisma.debtor
    .findMany({
      where: { file: { clientId }, assignedAgentId: { not: null } },
      distinct: ['assignedAgentId'],
      select: { assignedAgentId: true },
    })
    .then((rows) => rows.map((r) => r.assignedAgentId!));

  if (activeAgentIds.length > 0) {
    const weights = await agentCoverageWeights(clientId, activeAgentIds);
    const assignment = assignByCoverageWeight(
      created.map((d) => ({ id: d.id, balance: d.balance })),
      weights
    );
    await applyAssignment(assignment);
  }

  // A new account that arrived already partly paid is a real recovery — log it
  // the same way an ordinary reconciliation entry would, so reports pick it up.
  for (const debtor of created) {
    if (debtor.cumulativePaid > 0) {
      await prisma.reconciliationEntry.create({
        data: {
          reconciliationId,
          debtorId: debtor.id,
          oldBalance: debtor.amountOwed,
          newBalance: debtor.balance,
          paidAmount: debtor.cumulativePaid,
        },
      });
      onPaid(debtor.cumulativePaid);
    }
  }

  return created.length;
}
