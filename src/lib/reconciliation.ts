import { prisma } from './db';
import { loadTable, loadTableWithSheetTags, parseReconciliationRows, type ReconciliationRow, type ReconciliationMapping } from './excel';
import { assignByCoverageWeight } from './distribution';
import { agentCoverageWeights } from './coverage';
import { applyAssignment } from './assignment';
import { loadClientCommissionConfig, priceRow, type ClientCommissionConfig } from './commission';

export interface ProcessResult {
  updatedCount: number;
  totalUpdated: number;
  unmatchedCount: number;
  newAccountsCount: number;
  status: 'processed' | 'failed';
  errorSummary: string | null;
}

export interface ParseUploadResult {
  parsed: boolean;
  rowCount: number;
}

/**
 * Parses a reconciliation's stored raw upload into rawRows — a worker tick claims a
 * pending, not-yet-parsed reconciliation and calls this fire-and-forget, not awaited (see
 * api/worker/tick/route.ts): parsing a large file synchronously is what caused the
 * browser-facing hang in the first place, and even off the browser, a slow enough parse
 * can outlast Render's own inbound request timeout and get the *tick's* response killed
 * (confirmed in production — a stuck 'pending' reconciliation, tick logs showing a 502
 * after 2+ minutes). Not awaited means no timeout applies to it; it keeps running against
 * this same long-lived process after the tick's response has already gone out. Wrapped in
 * its own try/catch (rather than trusting the caller's fire-and-forget .catch(() => {}))
 * so a thrown error still reliably marks the reconciliation 'failed' and clears the claim
 * below, instead of leaving it silently stuck.
 *
 * Never falls through into processing in the same call — processing a reconciliation is
 * its own chunked, budget-bounded tick turn (see processReconciliationTick below), so
 * stacking it with this unbounded parse step would risk the exact same problem this is
 * fixing.
 */
export async function parseReconciliationUpload(reconciliationId: string): Promise<ParseUploadResult> {
  try {
    const r = await prisma.reconciliation.findUnique({ where: { id: reconciliationId } });
    if (!r?.rawFile || !r.rawFileName) {
      await prisma.reconciliation.update({
        where: { id: reconciliationId },
        data: { status: 'failed', errorSummary: 'No stored file to parse — the upload may have been interrupted, log a new reconciliation instead', parsingStartedAt: null },
      });
      return { parsed: false, rowCount: 0 };
    }

    const mapping: ReconciliationMapping = r.mapping ? JSON.parse(r.mapping) : {};
    const raw = Buffer.from(r.rawFile, 'base64');
    const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const type = r.type as 'full' | 'partial';

    // Sheet-tagged parsing only for clients with commission tracking configured (see
    // lib/commission.ts) — everyone else gets exactly the same loadTable call as before
    // this feature existed. KCB Mopesa's files use the sheet itself as the aging bucket,
    // no BUCKET column at all, so bucketRaw comes from sheetTags, not from `mapping`.
    const commissionConfig = await loadClientCommissionConfig(r.clientId);
    let rows: ReconciliationRow[];
    let errors: string[];
    if (commissionConfig) {
      const { table, sheetTags } = await loadTableWithSheetTags(buffer, r.rawFileName);
      ({ rows, errors } = parseReconciliationRows(table, mapping, type, sheetTags));
    } else {
      const table = await loadTable(buffer, r.rawFileName);
      ({ rows, errors } = parseReconciliationRows(table, mapping, type));
    }

    if (rows.length === 0) {
      await prisma.reconciliation.update({
        where: { id: reconciliationId },
        data: { status: 'failed', errorSummary: errors[0] ?? 'No valid rows found in the file', rawFile: null, parsingStartedAt: null },
      });
      return { parsed: false, rowCount: 0 };
    }

    await prisma.reconciliation.update({
      where: { id: reconciliationId },
      data: { rawRows: JSON.stringify(rows), recordCount: rows.length, rawFile: null, parsingStartedAt: null },
    });
    return { parsed: true, rowCount: rows.length };
  } catch (err) {
    await prisma.reconciliation
      .update({
        where: { id: reconciliationId },
        data: { status: 'failed', errorSummary: err instanceof Error ? err.message : 'Could not parse the uploaded file', parsingStartedAt: null },
      })
      .catch(() => {});
    return { parsed: false, rowCount: 0 };
  }
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
 *
 * Kept as the simple, one-query-per-row version deliberately — this is only ever called
 * with exactly one row now (see api/reconciliations/manual/route.ts), where that cost is
 * irrelevant. Every bulk-upload path uses processReconciliationTick below instead, which
 * applies these same matching rules in batches instead of one row at a time.
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
  const commissionConfig = await loadClientCommissionConfig(clientId);

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

    const priced = priceRow(commissionConfig, row.bucketRaw, paidAmount, !!debtor.assignedAgentId);

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
          bucket: priced.bucket,
          companyCommission: priced.companyCommission,
          agentCommission: priced.agentCommission,
        },
      }),
    ]);

    updatedCount++;
    totalUpdated += paidAmount;
  }

  const newAccountsCount = newAccountRows.length > 0
    ? await createAndDistributeNewAccounts(reconciliationId, clientId, newAccountRows, (paid) => { totalUpdated += paid; }, commissionConfig)
    : 0;

  const status: ProcessResult['status'] = updatedCount === 0 && newAccountsCount === 0 && rows.length > 0 ? 'failed' : 'processed';
  const errorSummary =
    unmatchedCount > 0
      ? `${unmatchedCount} of ${rows.length} record(s) could not be matched to a debtor or added as a new account (missing name/phone/amount owed).`
      : null;

  return { updatedCount, totalUpdated, unmatchedCount, newAccountsCount, status, errorSummary };
}

export interface TickResult {
  processed: number;
  done: boolean;
}

// One matching query per this many rows, not one per row — the actual fix here. The
// original processReconciliation did a `findFirst` *and* its own small transaction for
// every single row, sequentially; for a reconciliation with tens of thousands of rows
// that's tens of thousands of DB round trips before anything else can happen, and it
// wasn't resumable — a crash partway through would re-apply every row it already
// processed on retry, double-counting payments. Both are fixed the same way file import
// already was: batch the matching lookup (one findMany per BATCH_SIZE rows, using an `in`
// filter instead of one findFirst per row), batch the writes into one transaction per
// batch instead of one per row, and persist a rowsProcessed cursor after every batch so a
// tick that gets cut off resumes instead of restarting.
const BATCH_SIZE = 500;

/**
 * Chunked, resumable version of processReconciliation for the upload path — called once
 * per scheduled cron tick (see api/worker/tick/route.ts), repeatedly, until the whole
 * reconciliation is processed. See processReconciliation's docstring for the matching
 * rules themselves (loan ref preferred, phone fallback; unmatched-but-complete rows
 * become new accounts) — this applies the exact same rules, just batched.
 *
 * New-account rows are accumulated in pendingNewAccountRows across every chunk and only
 * turned into real debtors once, on the final chunk — calling createAndDistributeNewAccounts
 * once per chunk would create a separate "new accounts" File per chunk instead of one for
 * the whole run.
 */
export async function processReconciliationTick(reconciliationId: string, timeBudgetMs = 20000): Promise<TickResult> {
  const started = Date.now();
  const r = await prisma.reconciliation.findUnique({ where: { id: reconciliationId } });
  if (!r) return { processed: 0, done: true };
  if (!r.rawRows) {
    await prisma.reconciliation.update({
      where: { id: reconciliationId },
      data: { status: 'failed', errorSummary: 'No parsed rows to process — the upload may have been interrupted, log a new reconciliation instead' },
    });
    return { processed: 0, done: true };
  }

  const startCursor = r.rowsProcessed;

  try {
    const allRows: ReconciliationRow[] = JSON.parse(r.rawRows);
    const type = r.type as 'full' | 'partial';
    // Loaded once per tick, not per row/batch — rates don't change mid-run, and this is
    // null (no commission math at all) for every client without CommissionRate rows
    // configured, same as before this feature existed.
    const commissionConfig = await loadClientCommissionConfig(r.clientId);
    let cursor = r.rowsProcessed;
    let updatedCount = r.updatedCount;
    let totalUpdated = r.totalUpdated;
    let unmatchedCount = r.unmatchedCount;
    let pendingNewAccountRows: ReconciliationRow[] = r.pendingNewAccountRows ? JSON.parse(r.pendingNewAccountRows) : [];

    while (cursor < allRows.length && Date.now() - started < timeBudgetMs) {
      const batch = allRows.slice(cursor, cursor + BATCH_SIZE);

      const loanRefs = [...new Set(batch.map((row) => row.loanRef).filter((v): v is string => !!v))];
      const phones = [...new Set(batch.map((row) => row.phone).filter((v): v is string => !!v))];

      const candidates = loanRefs.length > 0 || phones.length > 0
        ? await prisma.debtor.findMany({
            where: {
              file: { clientId: r.clientId },
              OR: [
                ...(loanRefs.length > 0 ? [{ loanRef: { in: loanRefs } }] : []),
                ...(phones.length > 0 ? [{ phone1: { in: phones } }, { phone2: { in: phones } }] : []),
              ],
            },
          })
        : [];

      const byLoanRef = new Map(candidates.map((d) => [d.loanRef, d]));
      const byPhone = new Map<string, (typeof candidates)[number]>();
      for (const d of candidates) {
        if (d.phone1 && !byPhone.has(d.phone1)) byPhone.set(d.phone1, d);
        if (d.phone2 && !byPhone.has(d.phone2)) byPhone.set(d.phone2, d);
      }

      const debtorUpdates: ReturnType<typeof prisma.debtor.update>[] = [];
      const entryCreates: ReturnType<typeof prisma.reconciliationEntry.create>[] = [];
      // A duplicate loan ref/phone within one batch means the same debtor gets touched
      // twice before the batch's transaction ever commits — track each debtor's
      // running (not-yet-committed) cumulativePaid so the second occurrence builds on
      // the first instead of both computing off the same stale, pre-batch value.
      const runningCumulativePaid = new Map<string, number>();

      for (const row of batch) {
        const debtor = (row.loanRef && byLoanRef.get(row.loanRef)) || (row.phone && byPhone.get(row.phone)) || null;

        if (!debtor) {
          if (row.name && row.phone && row.amountOwed !== null) {
            pendingNewAccountRows.push(row);
          } else {
            unmatchedCount++;
          }
          continue;
        }

        const alreadyTouched = runningCumulativePaid.has(debtor.id);
        const currentCumulativePaid = runningCumulativePaid.get(debtor.id) ?? debtor.cumulativePaid;
        const oldBalance = alreadyTouched ? Math.max(0, debtor.amountOwed - currentCumulativePaid) : debtor.balance;
        const newCumulativePaid = type === 'full' ? row.amount : currentCumulativePaid + row.amount;
        const newBalance = Math.max(0, debtor.amountOwed - newCumulativePaid);
        const paidAmount = Math.max(0, newCumulativePaid - currentCumulativePaid);
        runningCumulativePaid.set(debtor.id, newCumulativePaid);

        debtorUpdates.push(
          prisma.debtor.update({ where: { id: debtor.id }, data: { cumulativePaid: newCumulativePaid, balance: newBalance } })
        );
        const priced = priceRow(commissionConfig, row.bucketRaw, paidAmount, !!debtor.assignedAgentId);
        entryCreates.push(
          prisma.reconciliationEntry.create({
            data: {
              reconciliationId, debtorId: debtor.id, oldBalance, newBalance, paidAmount,
              bucket: priced.bucket, companyCommission: priced.companyCommission, agentCommission: priced.agentCommission,
            },
          })
        );

        updatedCount++;
        totalUpdated += paidAmount;
      }

      if (debtorUpdates.length > 0) {
        await prisma.$transaction([...debtorUpdates, ...entryCreates]);
      }

      cursor += batch.length;

      await prisma.reconciliation.update({
        where: { id: reconciliationId },
        data: {
          rowsProcessed: cursor,
          updatedCount,
          totalUpdated,
          unmatchedCount,
          pendingNewAccountRows: JSON.stringify(pendingNewAccountRows),
        },
      });
    }

    const done = cursor >= allRows.length;
    if (done) {
      const newAccountsCount = pendingNewAccountRows.length > 0
        ? await createAndDistributeNewAccounts(reconciliationId, r.clientId, pendingNewAccountRows, (paid) => { totalUpdated += paid; }, commissionConfig)
        : 0;

      const status: ProcessResult['status'] = updatedCount === 0 && newAccountsCount === 0 && allRows.length > 0 ? 'failed' : 'processed';
      const errorSummary = unmatchedCount > 0
        ? `${unmatchedCount} of ${allRows.length} record(s) could not be matched to a debtor or added as a new account (missing name/phone/amount owed).`
        : null;

      await prisma.reconciliation.update({
        where: { id: reconciliationId },
        data: { status, newAccountsCount, totalUpdated, errorSummary, processedAt: new Date(), pendingNewAccountRows: null },
      });
    }

    return { processed: cursor - startCursor, done };
  } catch (err) {
    await prisma.reconciliation
      .update({
        where: { id: reconciliationId },
        data: { status: 'failed', errorSummary: err instanceof Error ? err.message : 'Processing failed', processedAt: new Date() },
      })
      .catch(() => {});
    return { processed: 0, done: true };
  }
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
  onPaid: (amount: number) => void,
  commissionConfig: ClientCommissionConfig | null
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

  let assignment = new Map<string, string>();
  if (activeAgentIds.length > 0) {
    const weights = await agentCoverageWeights(clientId, activeAgentIds);
    assignment = assignByCoverageWeight(
      created.map((d) => ({ id: d.id, balance: d.balance })),
      weights
    );
    await applyAssignment(assignment);
  }

  // A new account that arrived already partly paid is a real recovery — log it
  // the same way an ordinary reconciliation entry would, so reports pick it up.
  // Priced off the source row's own bucket, not the new debtor's freshly-assigned agent's
  // usual bucket — `created[i]` and `newAccountRows[i]` stay in step because
  // createManyAndReturn preserves input order.
  for (let i = 0; i < created.length; i++) {
    const debtor = created[i];
    if (debtor.cumulativePaid > 0) {
      const priced = priceRow(commissionConfig, newAccountRows[i].bucketRaw, debtor.cumulativePaid, assignment.has(debtor.id));
      await prisma.reconciliationEntry.create({
        data: {
          reconciliationId,
          debtorId: debtor.id,
          oldBalance: debtor.amountOwed,
          newBalance: debtor.balance,
          paidAmount: debtor.cumulativePaid,
          bucket: priced.bucket,
          companyCommission: priced.companyCommission,
          agentCommission: priced.agentCommission,
        },
      });
      onPaid(debtor.cumulativePaid);
    }
  }

  return created.length;
}
