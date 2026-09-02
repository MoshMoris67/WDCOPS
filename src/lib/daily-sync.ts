import { prisma } from './db';
import {
  loadNamedSheets,
  parseImportRows,
  parseSyncPaymentRows,
  type ImportMapping,
  type SyncPaymentMapping,
} from './excel';
import { assignByCoverageWeight } from './distribution';
import { agentCoverageWeights } from './coverage';
import { applyAssignment } from './assignment';

// One INSERT per this many rows — same reasoning as file-import.ts's BATCH_SIZE: keeps any
// single query lightweight regardless of how many genuinely new loans showed up (worst
// case, a first-ever sync where none of the ~26,000-row calling list exists yet).
const BATCH_SIZE = 1000;

function monthRange(now: Date): { start: Date; endExclusive: Date } {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    endExclusive: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

function dedupeKey(debtorId: string, paidDate: Date, paidAmount: number): string {
  return `${debtorId}|${paidDate.toISOString()}|${paidAmount}`;
}

/**
 * Runs one daily sync against a File that already exists — see prisma/schema.prisma's
 * FileSync comment for the full picture. Two independent steps, in order:
 *
 * 1. Calling-list diff: any loanRef on the calling-list sheet not already a Debtor on this
 *    File is genuinely new — created and auto-distributed the same coverage-weighted way
 *    reconciliation.ts's new-account path already does (same assignByCoverageWeight/
 *    agentCoverageWeights/applyAssignment calls), except into *this* File rather than a
 *    fresh one, since the whole point is one continuously-extended file, not a new batch
 *    every day. A loanRef already present is left completely untouched — this step only
 *    ever adds debtors, never updates one.
 *
 * 2. Current-month payments: the payments sheet is a full accumulating export (re-sends
 *    the same historical rows every day, confirmed against real Zenka files), so this
 *    filters to the current calendar month and only applies a payment whose exact
 *    (debtor, paidDate, paidAmount) hasn't already been recorded as a ReconciliationEntry —
 *    otherwise every re-upload would double-count the same recoveries. Applied payments
 *    become a real Reconciliation + ReconciliationEntry (companyCommission taken directly
 *    from the source file's own column when mapped, never recomputed — trusted as-is), so
 *    existing recovery reporting picks them up with no changes needed there.
 */
export async function runFileSync(fileSyncId: string): Promise<void> {
  const sync = await prisma.fileSync.findUnique({ where: { id: fileSyncId } });
  if (!sync) return;

  try {
    if (!sync.rawFile || !sync.rawFileName) {
      await prisma.fileSync.update({
        where: { id: fileSyncId },
        data: { status: 'failed', error: 'No stored file to sync — the upload may have been interrupted, re-upload it', parsingStartedAt: null },
      });
      return;
    }

    const file = await prisma.file.findUnique({ where: { id: sync.fileId }, select: { id: true, clientId: true } });
    if (!file) {
      await prisma.fileSync.update({
        where: { id: fileSyncId },
        data: { status: 'failed', error: 'The target file no longer exists', parsingStartedAt: null },
      });
      return;
    }

    const callingListMapping: ImportMapping = sync.callingListMapping ? JSON.parse(sync.callingListMapping) : {};
    const paymentMapping: SyncPaymentMapping = sync.paymentMapping ? JSON.parse(sync.paymentMapping) : {};

    const raw = Buffer.from(sync.rawFile, 'base64');
    const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const sheets = await loadNamedSheets(buffer, sync.rawFileName);
    if (sheets.length < 2) {
      await prisma.fileSync.update({
        where: { id: fileSyncId },
        data: { status: 'failed', error: 'This file needs at least two sheets — a calling list and a payments sheet', rawFile: null, parsingStartedAt: null },
      });
      return;
    }

    const newDebtorsCount = await syncCallingList(file.id, file.clientId, sheets[0].rows, callingListMapping);
    const { appliedCount, skippedCount } = await syncPayments(file.id, sheets[1].rows, paymentMapping);

    await prisma.fileSync.update({
      where: { id: fileSyncId },
      data: {
        status: 'complete',
        newDebtorsCount,
        paymentsAppliedCount: appliedCount,
        paymentsSkippedCount: skippedCount,
        rawFile: null,
        parsingStartedAt: null,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.fileSync
      .update({
        where: { id: fileSyncId },
        data: { status: 'failed', error: err instanceof Error ? err.message : 'Sync failed', parsingStartedAt: null },
      })
      .catch(() => {});
  }
}

async function syncCallingList(fileId: string, clientId: string, table: string[][], mapping: ImportMapping): Promise<number> {
  const { rows } = parseImportRows(table, mapping);
  if (rows.length === 0) return 0;

  const existingLoanRefs = new Set(
    (await prisma.debtor.findMany({ where: { fileId }, select: { loanRef: true } })).map((d) => d.loanRef)
  );

  // Dedupe within this upload too — a loanRef repeated twice in the same calling list
  // (shouldn't happen, but loanRef isn't a unique-constrained column) would otherwise
  // create two debtor rows for the same loan.
  const seen = new Set<string>();
  const newRows = rows.filter((r) => {
    if (existingLoanRefs.has(r.loanRef) || seen.has(r.loanRef)) return false;
    seen.add(r.loanRef);
    return true;
  });
  if (newRows.length === 0) return 0;

  const created: { id: string; balance: number }[] = [];
  for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
    const batch = newRows.slice(i, i + BATCH_SIZE);
    const rowsCreated = await prisma.debtor.createManyAndReturn({
      data: batch.map((r) => {
        const balance = r.balance ?? r.amountOwed;
        const cumulativePaid = Math.max(0, r.amountOwed - balance);
        return { fileId, name: r.name, phone1: r.phone1, phone2: r.phone2, loanRef: r.loanRef, amountOwed: r.amountOwed, cumulativePaid, balance };
      }),
      select: { id: true, balance: true },
    });
    created.push(...rowsCreated);
  }

  const activeAgentIds = await prisma.debtor
    .findMany({
      where: { file: { clientId }, assignedAgentId: { not: null } },
      distinct: ['assignedAgentId'],
      select: { assignedAgentId: true },
    })
    .then((agentRows) => agentRows.map((r) => r.assignedAgentId!));

  if (activeAgentIds.length > 0) {
    const weights = await agentCoverageWeights(clientId, activeAgentIds);
    const assignment = assignByCoverageWeight(created, weights);
    await applyAssignment(assignment);
  }

  return created.length;
}

async function syncPayments(
  fileId: string,
  table: string[][],
  mapping: SyncPaymentMapping
): Promise<{ appliedCount: number; skippedCount: number }> {
  const { rows } = parseSyncPaymentRows(table, mapping);
  const { start, endExclusive } = monthRange(new Date());
  const thisMonthRows = rows.filter((r) => r.paidDate >= start && r.paidDate < endExclusive);
  if (thisMonthRows.length === 0) return { appliedCount: 0, skippedCount: 0 };

  const loanRefs = [...new Set(thisMonthRows.map((r) => r.loanRef))];
  const debtors = await prisma.debtor.findMany({
    where: { fileId, loanRef: { in: loanRefs } },
    select: { id: true, loanRef: true, amountOwed: true, cumulativePaid: true },
  });
  const byLoanRef = new Map(debtors.map((d) => [d.loanRef, d]));

  const debtorIds = debtors.map((d) => d.id);
  const alreadyRecorded = debtorIds.length > 0
    ? await prisma.reconciliationEntry.findMany({
        where: { debtorId: { in: debtorIds }, paidDate: { gte: start, lt: endExclusive } },
        select: { debtorId: true, paidDate: true, paidAmount: true },
      })
    : [];
  const recordedKeys = new Set(alreadyRecorded.map((e) => dedupeKey(e.debtorId, e.paidDate!, e.paidAmount)));

  let appliedCount = 0;
  let skippedCount = 0;
  const runningCumulativePaid = new Map<string, number>();
  const debtorUpdates: ReturnType<typeof prisma.debtor.update>[] = [];
  const entryData: {
    debtorId: string; oldBalance: number; newBalance: number; paidAmount: number;
    paidDate: Date; companyCommission: number | null;
  }[] = [];

  for (const row of thisMonthRows) {
    const debtor = byLoanRef.get(row.loanRef);
    if (!debtor) { skippedCount++; continue; }
    if (recordedKeys.has(dedupeKey(debtor.id, row.paidDate, row.paidAmount))) { skippedCount++; continue; }

    const currentCumulativePaid = runningCumulativePaid.get(debtor.id) ?? debtor.cumulativePaid;
    const oldBalance = Math.max(0, debtor.amountOwed - currentCumulativePaid);
    const newCumulativePaid = currentCumulativePaid + row.paidAmount;
    const newBalance = Math.max(0, debtor.amountOwed - newCumulativePaid);
    runningCumulativePaid.set(debtor.id, newCumulativePaid);

    debtorUpdates.push(prisma.debtor.update({ where: { id: debtor.id }, data: { cumulativePaid: newCumulativePaid, balance: newBalance } }));
    entryData.push({
      debtorId: debtor.id, oldBalance, newBalance, paidAmount: row.paidAmount,
      paidDate: row.paidDate, companyCommission: row.companyCommission,
    });
    appliedCount++;
    recordedKeys.add(dedupeKey(debtor.id, row.paidDate, row.paidAmount));
  }

  if (entryData.length > 0) {
    const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId }, select: { clientId: true } });
    const reconciliation = await prisma.reconciliation.create({
      data: {
        clientId: file.clientId,
        fileId,
        type: 'partial',
        receivedAt: new Date(),
        processedAt: new Date(),
        recordCount: entryData.length,
        updatedCount: entryData.length,
        totalUpdated: entryData.reduce((s, e) => s + e.paidAmount, 0),
        status: 'processed',
      },
    });

    await prisma.$transaction([
      ...debtorUpdates,
      ...entryData.map((e) => prisma.reconciliationEntry.create({ data: { reconciliationId: reconciliation.id, ...e } })),
    ]);
  }

  return { appliedCount, skippedCount };
}
