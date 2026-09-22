import { Prisma } from '@prisma/client';
import { prisma } from './db';
import {
  iterateTable,
  parseReconciliationRows,
  type ReconciliationRow,
  type ReconciliationMapping,
} from './excel';
import { assignByCoverageWeight } from './distribution';
import { agentCoverageWeights } from './coverage';
import { writeAssignment } from './assignment';
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
 * api/worker/tick/route.ts).
 *
 * Uses iterateTable to stream the file, but still materializes rows into rawRows (JSON)
 * for the resumable processReconciliationTick path. This is a compromise: we avoid
 * the peak memory spike of loadTable (which builds a full 2D array), but we still
 * store the parsed rows in the DB to allow chunked matching.
 */
export async function parseReconciliationUpload(reconciliationId: string): Promise<ParseUploadResult> {
  try {
    const r = await prisma.reconciliation.findUnique({ where: { id: reconciliationId } });
    if (!r?.rawFile || !r.rawFileName) {
      await prisma.reconciliation.update({
        where: { id: reconciliationId },
        data: {
          status: 'failed',
          errorSummary: 'No stored file to parse — the upload may have been interrupted, log a new reconciliation instead',
          parsingStartedAt: null,
        },
      });
      return { parsed: false, rowCount: 0 };
    }

    const mapping: ReconciliationMapping = r.mapping ? JSON.parse(r.mapping) : {};
    const raw = Buffer.from(r.rawFile, 'base64');
    const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const type = r.type as 'full' | 'partial';

    const rows: ReconciliationRow[] = [];
    const errors: string[] = [];
    const table: string[][] = [];
    const sheetTags: string[] = [];

    await iterateTable(buffer, r.rawFileName, (row, index, sheetName) => {
      table.push(row);
      sheetTags.push(sheetName);
    });

    const { rows: parsedRows, errors: parseErrors } = parseReconciliationRows(table, mapping, type, sheetTags);

    if (parsedRows.length === 0) {
      await prisma.reconciliation.update({
        where: { id: reconciliationId },
        data: {
          status: 'failed',
          errorSummary: parseErrors[0] ?? 'No valid rows found in the file',
          rawFile: null,
          parsingStartedAt: null,
        },
      });
      return { parsed: false, rowCount: 0 };
    }

    await prisma.reconciliation.update({
      where: { id: reconciliationId },
      data: { rawRows: JSON.stringify(parsedRows), recordCount: parsedRows.length, rawFile: null, parsingStartedAt: null },
    });
    return { parsed: true, rowCount: parsedRows.length };
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
  const touched = new Set<string>();

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

    const newCumulativePaid = type === 'full' && !touched.has(debtor.id) ? row.amount : debtor.cumulativePaid + row.amount;
    const newBalance = Math.max(0, debtor.amountOwed - newCumulativePaid);
    const paidAmount = Math.max(0, newCumulativePaid - debtor.cumulativePaid);
    touched.add(debtor.id);

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

  let newAccountsCount = 0;
  if (newAccountRows.length > 0) {
    const ctx = await loadNewAccountContext(clientId);
    const result = await prisma.$transaction(
      (tx) => createNewAccounts(tx, reconciliationId, clientId, newAccountRows, commissionConfig, ctx),
      { timeout: 60_000 }
    );
    newAccountsCount = result.createdCount;
    totalUpdated += result.paidTotal;
  }

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
  /** Another tick or "Process now" is already working on this reconciliation. */
  busy?: boolean;
}

// A processing claim older than this is treated as abandoned (the process holding it
// crashed or was restarted) and can be taken over. Well above any tick's time budget plus
// the final new-accounts transaction's 60s timeout.
const STALE_PROCESSING_CLAIM_MS = 5 * 60 * 1000;

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
 * turned into real debtors once, on the final chunk — calling createNewAccounts
 * once per chunk would create a separate "new accounts" File per chunk instead of one for
 * the whole run.
 */
export async function processReconciliationTick(reconciliationId: string, timeBudgetMs = 20000): Promise<TickResult> {
  // Only one worker at a time: the cron tick and "Process now" used to be able to run the
  // same reconciliation together. Both then started from the same saved cursor and totals,
  // re-did each other's batches (the second pass recording 0 paid, since the first had
  // already applied it) and each saved its own running totals over the other's — the
  // debtors' figures ended up right but the log's amount came out millions short.
  const claimedAt = new Date();
  const claim = await prisma.reconciliation.updateMany({
    where: {
      id: reconciliationId,
      OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: new Date(claimedAt.getTime() - STALE_PROCESSING_CLAIM_MS) } }],
    },
    data: { processingStartedAt: claimedAt },
  });
  if (claim.count === 0) {
    const exists = await prisma.reconciliation.count({ where: { id: reconciliationId } });
    return exists ? { processed: 0, done: false, busy: true } : { processed: 0, done: true };
  }

  try {
    return await runReconciliationTick(reconciliationId, timeBudgetMs);
  } finally {
    await prisma.reconciliation
      .updateMany({ where: { id: reconciliationId, processingStartedAt: claimedAt }, data: { processingStartedAt: null } })
      .catch(() => {});
  }
}

async function runReconciliationTick(reconciliationId: string, timeBudgetMs: number): Promise<TickResult> {
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

      // Debtors an earlier batch of this same reconciliation already applied a row to (every
      // matched row writes an entry, even a 0 one). In a full reconciliation a debtor's first
      // row sets their cumulative figure and every further row for them in the same file
      // adds to it: KCB's file lists a loan once per aging bucket it was collected in (e.g.
      // "Before 60" and "60-89"), sheets thousands of rows apart, and the loan's collections
      // are the sum of those rows — the second row used to replace the first instead.
      const touchedEarlier = type === 'full' && candidates.length > 0
        ? new Set(
            (await prisma.reconciliationEntry.findMany({
              where: { reconciliationId, debtorId: { in: candidates.map((d) => d.id) } },
              select: { debtorId: true },
              distinct: ['debtorId'],
            })).map((e) => e.debtorId)
          )
        : new Set<string>();

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
        const firstRowForDebtor = !alreadyTouched && !touchedEarlier.has(debtor.id);
        const newCumulativePaid = type === 'full' && firstRowForDebtor ? row.amount : currentCumulativePaid + row.amount;
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

      cursor += batch.length;

      // The batch's writes and the cursor past it commit together. Saved separately, a crash
      // between the two re-ran an already-applied batch on the next tick — now that a full
      // reconciliation adds a debtor's later rows onto their earlier ones, that would count
      // the batch twice.
      await prisma.$transaction([
        ...debtorUpdates,
        ...entryCreates,
        prisma.reconciliation.update({
          where: { id: reconciliationId },
          data: {
            rowsProcessed: cursor,
            updatedCount,
            totalUpdated,
            unmatchedCount,
            pendingNewAccountRows: JSON.stringify(pendingNewAccountRows),
          },
        }),
      ]);
    }

    const done = cursor >= allRows.length;
    if (done) {
      const ctx = pendingNewAccountRows.length > 0 ? await loadNewAccountContext(r.clientId) : null;
      // Finishing (new accounts + the final status) is one transaction, opened by claiming
      // the not-yet-processed row: a retry after a crash between creating the new accounts
      // and clearing pendingNewAccountRows used to create the same new accounts a second
      // time. Overlapping runs are already kept out by the processing claim above.
      await prisma.$transaction(
        async (tx) => {
          const claim = await tx.reconciliation.updateMany({
            where: { id: reconciliationId, status: { not: 'processed' } },
            data: { pendingNewAccountRows: null },
          });
          if (claim.count === 0) return;

          let newAccountsCount = 0;
          if (ctx) {
            const result = await createNewAccounts(tx, reconciliationId, r.clientId, pendingNewAccountRows, commissionConfig, ctx);
            newAccountsCount = result.createdCount;
            totalUpdated += result.paidTotal;
          }

          const status: ProcessResult['status'] = updatedCount === 0 && newAccountsCount === 0 && allRows.length > 0 ? 'failed' : 'processed';
          const errorSummary = unmatchedCount > 0
            ? `${unmatchedCount} of ${allRows.length} record(s) could not be matched to a debtor or added as a new account (missing name/phone/amount owed).`
            : null;

          await tx.reconciliation.update({
            where: { id: reconciliationId },
            data: { status, newAccountsCount, totalUpdated, errorSummary, processedAt: new Date() },
          });
        },
        { timeout: 60_000 }
      );
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
  // One statement: delete this reconciliation's entries and subtract what they paid, with
  // the subtraction done by Postgres against each debtor's current row rather than a value
  // read earlier. Reading debtors first and writing back a computed figure (the old version)
  // let two deletes running at once both start from the same cumulativePaid, so the later
  // write silently undid the earlier one's reversal and money stayed "recovered". Deleting
  // via RETURNING also means a repeated delete of the same reconciliation (a double click)
  // finds no entries left to reverse instead of subtracting them twice.
  const reversedCount = await prisma.$transaction(async (tx) => {
    const count = await tx.$executeRaw`
      WITH removed AS (
        DELETE FROM "ReconciliationEntry" WHERE "reconciliationId" = ${reconciliationId}
        RETURNING "debtorId", "paidAmount"
      ), per_debtor AS (
        SELECT "debtorId", SUM("paidAmount") AS paid FROM removed GROUP BY "debtorId"
      )
      UPDATE "Debtor" d
      SET "cumulativePaid" = GREATEST(0, d."cumulativePaid" - p.paid),
          "balance" = GREATEST(0, d."amountOwed" - GREATEST(0, d."cumulativePaid" - p.paid))
      FROM per_debtor p
      WHERE d.id = p."debtorId"
    `;
    await tx.reconciliation.deleteMany({ where: { id: reconciliationId } });
    return count;
  });

  return { reversedCount };
}

interface NewAccountContext {
  clientName: string;
  weights: Awaited<ReturnType<typeof agentCoverageWeights>>;
}

// The reads createNewAccounts needs, done before its transaction opens so the transaction
// holds its locks only for the writes.
async function loadNewAccountContext(clientId: string): Promise<NewAccountContext> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true } });
  const activeAgentIds = await prisma.debtor
    .findMany({
      where: { file: { clientId }, assignedAgentId: { not: null } },
      distinct: ['assignedAgentId'],
      select: { assignedAgentId: true },
    })
    .then((rows) => rows.map((r) => r.assignedAgentId!));
  const weights = activeAgentIds.length > 0 ? await agentCoverageWeights(clientId, activeAgentIds) : [];
  return { clientName: client.name, weights };
}

/**
 * Turns unmatched-but-complete rows into new debtors, assigns them, and logs the starting
 * payment each arrived with — all on the caller's transaction. It has to be one unit: a
 * new debtor starts with cumulativePaid already set, and before this ran in a transaction
 * a crash or timeout between creating the debtors and writing their entries left paid
 * debtors with no entry, which reverseAndDeleteReconciliation (driven by entries) then
 * could never take back out — "Recovered" stuck on a client whose reconciliations were
 * all deleted.
 */
// Rows for the same not-yet-existing account (same loan ref, else same phone) become one
// new debtor, with their amounts added — the same rule the matched rows follow. Without
// this, a loan listed on two of KCB's bucket sheets became two debtors with one loan ref.
// amountOwed takes the largest figure: after a loan rolls into the next bucket, its later
// row's outstanding is already net of what the earlier row collected.
function mergeNewAccountRows(rows: ReconciliationRow[]): ReconciliationRow[] {
  const merged = new Map<string, ReconciliationRow>();
  for (const row of rows) {
    const key = row.loanRef ? `ref:${row.loanRef}` : `phone:${row.phone}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row });
      continue;
    }
    existing.amount += row.amount;
    existing.amountOwed = Math.max(existing.amountOwed ?? 0, row.amountOwed ?? 0);
  }
  return [...merged.values()];
}

async function createNewAccounts(
  tx: Prisma.TransactionClient,
  reconciliationId: string,
  clientId: string,
  unmergedRows: ReconciliationRow[],
  commissionConfig: ClientCommissionConfig | null,
  ctx: NewAccountContext
): Promise<{ createdCount: number; paidTotal: number }> {
  const newAccountRows = mergeNewAccountRows(unmergedRows);
  const newFile = await tx.file.create({
    data: {
      clientId,
      batchLabel: `${ctx.clientName} — New accounts via reconciliation ${new Date().toISOString().slice(0, 10)}`,
      receivedDate: new Date(),
      isMidMonthTopup: true,
    },
  });

  // createManyAndReturn batches this into one INSERT instead of one per new account —
  // matters just as much here as it does for a fresh file import (see api/files/route.ts).
  const created = await tx.debtor.createManyAndReturn({
    data: newAccountRows.map((row) => {
      const amountOwed = row.amountOwed!;
      // Not capped at amountOwed — a matched debtor's collections aren't either, and a
      // client's collections figure is taken as reported (KCB's can exceed the listed
      // outstanding when a paid-off loan appears on two bucket sheets).
      const cumulativePaid = row.amount;
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

  const assignment = assignByCoverageWeight(
    created.map((d) => ({ id: d.id, balance: d.balance })),
    ctx.weights
  );
  await writeAssignment(tx, assignment);

  // A new account that arrived already partly paid is a real recovery — log it
  // the same way an ordinary reconciliation entry would, so reports pick it up.
  // Priced off the source row's own bucket, not the new debtor's freshly-assigned agent's
  // usual bucket — `created[i]` and `newAccountRows[i]` stay in step because
  // createManyAndReturn preserves input order.
  let paidTotal = 0;
  const entries: Prisma.ReconciliationEntryCreateManyInput[] = [];
  for (let i = 0; i < created.length; i++) {
    const debtor = created[i];
    if (debtor.cumulativePaid > 0) {
      const priced = priceRow(commissionConfig, newAccountRows[i].bucketRaw, debtor.cumulativePaid, assignment.has(debtor.id));
      entries.push({
        reconciliationId,
        debtorId: debtor.id,
        oldBalance: debtor.amountOwed,
        newBalance: debtor.balance,
        paidAmount: debtor.cumulativePaid,
        bucket: priced.bucket,
        companyCommission: priced.companyCommission,
        agentCommission: priced.agentCommission,
      });
      paidTotal += debtor.cumulativePaid;
    }
  }
  if (entries.length > 0) await tx.reconciliationEntry.createMany({ data: entries });

  return { createdCount: created.length, paidTotal };
}
