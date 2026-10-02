import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';
import { chunkedDeleteDebtors } from '@/lib/debtor-delete';

// The business runs on Kampala time (UTC+3, no DST), so "the start of this month" is
// midnight there — not midnight UTC, which would put a reconciliation received at 01:00 on
// the 1st on the wrong side of the cutoff.
const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000;
// A reconciliation a worker tick or "Process now" claimed this recently may still be
// writing entries — deleting it underneath would let those entries reappear.
const BUSY_WINDOW_MS = 10 * 60 * 1000;
// Float-safe "has no balance left" — balances are recomputed as amountOwed - cumulativePaid.
const CLEARED = 0.005;

export function currentMonthStart(now = new Date()): Date {
  const k = new Date(now.getTime() + KAMPALA_OFFSET_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KAMPALA_OFFSET_MS);
}

export interface NewMonthPlan {
  clientName: string;
  cutoff: Date;
  /** Reconciliations received before this month — these are cleared. */
  reconciliations: {
    id: string;
    type: string;
    status: string;
    receivedAt: Date;
    batchLabel: string | null;
    recordCount: number;
    updatedCount: number;
    newAccountsCount: number;
    totalUpdated: number;
    busy: boolean;
  }[];
  entryCount: number;
  recoveredTotal: number;
  /** Debtors at zero balance with no payment in a kept (this-month) reconciliation. */
  clearedDebtorCount: number;
  keptZeroBalanceCount: number;
  /** Sum of every balance on the client's books — becomes the new total outstanding. */
  outstandingTotal: number;
  debtorCount: number;
  /** Files that would have no debtors left once the zero-balance ones go. */
  filesEmptied: { id: string; batchLabel: string }[];
}

export async function planNewMonth(clientId: string): Promise<NewMonthPlan | null> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  if (!client) return null;

  const cutoff = currentMonthStart();
  const busySince = new Date(Date.now() - BUSY_WINDOW_MS);

  const [recons, entryAgg, balanceAgg, files, zeroByFile, totalByFile] = await Promise.all([
    prisma.reconciliation.findMany({
      where: { clientId, receivedAt: { lt: cutoff } },
      include: { file: { select: { batchLabel: true } } },
      orderBy: { receivedAt: 'asc' },
    }),
    prisma.reconciliationEntry.aggregate({
      where: { reconciliation: { clientId, receivedAt: { lt: cutoff } } },
      _count: true,
      _sum: { paidAmount: true },
    }),
    prisma.debtor.aggregate({
      where: { file: { clientId } },
      _count: true,
      _sum: { balance: true },
    }),
    prisma.file.findMany({ where: { clientId }, select: { id: true, batchLabel: true } }),
    prisma.debtor.groupBy({
      by: ['fileId'],
      where: { file: { clientId }, balance: { lte: CLEARED }, ...keptEntryFilter(cutoff) },
      _count: true,
    }),
    prisma.debtor.groupBy({ by: ['fileId'], where: { file: { clientId } }, _count: true }),
  ]);

  const keptZero = await prisma.debtor.count({
    where: { file: { clientId }, balance: { lte: CLEARED }, reconciliationEntries: { some: { reconciliation: { receivedAt: { gte: cutoff } } } } },
  });

  const totals = new Map(totalByFile.map((t) => [t.fileId, t._count]));
  const zeros = new Map(zeroByFile.map((z) => [z.fileId, z._count]));
  const filesEmptied = files.filter((f) => (totals.get(f.id) ?? 0) > 0 && zeros.get(f.id) === totals.get(f.id));

  return {
    clientName: client.name,
    cutoff,
    reconciliations: recons.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      receivedAt: r.receivedAt,
      batchLabel: r.file?.batchLabel ?? null,
      recordCount: r.recordCount,
      updatedCount: r.updatedCount,
      newAccountsCount: r.newAccountsCount,
      totalUpdated: r.totalUpdated,
      busy: !!r.processingStartedAt && r.processingStartedAt > busySince,
    })),
    entryCount: entryAgg._count,
    recoveredTotal: entryAgg._sum.paidAmount ?? 0,
    clearedDebtorCount: [...zeros.values()].reduce((s, n) => s + n, 0),
    keptZeroBalanceCount: keptZero,
    outstandingTotal: balanceAgg._sum.balance ?? 0,
    debtorCount: balanceAgg._count,
    filesEmptied,
  };
}

function keptEntryFilter(cutoff: Date) {
  return { reconciliationEntries: { none: { reconciliation: { receivedAt: { gte: cutoff } } } } };
}

export interface NewMonthResult {
  reconciliationsCleared: number;
  entriesCleared: number;
  debtorsRemoved: number;
  filesEmptied: { id: string; batchLabel: string }[];
  outstandingTotal: number;
}

/**
 * Rolls a client over into a new month, in one transaction:
 *  1. Deletes every reconciliation received before this month — WITHOUT reversing the
 *     balances they changed. Those payments really happened; last month's recoveries just
 *     stop counting toward this month.
 *  2. Rebases every debtor so what is outstanding now becomes the new total outstanding:
 *     amountOwed = balance, cumulativePaid = 0 (or just what this month's reconciliations
 *     already recorded, so a later delete of one of those still reverses exactly).
 *  3. Removes debtors at zero balance (with their calls and assignments) unless they paid
 *     in a this-month reconciliation, whose recovery they still carry.
 * Files are never deleted here — which batches to drop is the admin's call.
 */
export async function runNewMonth(clientId: string): Promise<NewMonthResult | { error: string }> {
  const plan = await planNewMonth(clientId);
  if (!plan) return { error: 'Client not found' };
  if (plan.reconciliations.some((r) => r.busy)) {
    return { error: 'A reconciliation is still being processed — wait for it to finish, then try again' };
  }
  const cutoff = plan.cutoff;

  return prisma.$transaction(
    async (tx) => {
      const reconIds = plan.reconciliations.map((r) => r.id);
      const entries = await tx.reconciliationEntry.deleteMany({ where: { reconciliationId: { in: reconIds } } });
      const recons = await tx.reconciliation.deleteMany({ where: { id: { in: reconIds } } });

      await tx.$executeRaw`
        UPDATE "Debtor" d
        SET "amountOwed" = d."balance" + kept.paid,
            "cumulativePaid" = kept.paid
        FROM (
          SELECT d2.id, COALESCE((SELECT SUM(e."paidAmount") FROM "ReconciliationEntry" e WHERE e."debtorId" = d2.id), 0) AS paid
          FROM "Debtor" d2
          JOIN "File" f ON f.id = d2."fileId"
          WHERE f."clientId" = ${clientId}
        ) kept
        WHERE d.id = kept.id
      `;

      const zero = await tx.debtor.findMany({
        where: { file: { clientId }, balance: { lte: CLEARED }, ...keptEntryFilter(cutoff) },
        select: { id: true },
      });
      await chunkedDeleteDebtors(tx, zero.map((d) => d.id));

      const files = await tx.file.findMany({ where: { clientId }, select: { id: true, batchLabel: true, _count: { select: { debtors: true } } } });
      const outstanding = await tx.debtor.aggregate({ where: { file: { clientId } }, _sum: { balance: true } });

      return {
        reconciliationsCleared: recons.count,
        entriesCleared: entries.count,
        debtorsRemoved: zero.length,
        filesEmptied: files.filter((f) => f._count.debtors === 0).map((f) => ({ id: f.id, batchLabel: f.batchLabel })),
        outstandingTotal: outstanding._sum.balance ?? 0,
      };
    },
    { timeout: 300_000, maxWait: 30_000 }
  );
}

// ---- Exports (always taken before anything is deleted) ----

function header(sheet: ExcelJS.Worksheet, columns: { header: string; key: string; width: number }[]) {
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
}

const PAGE = 5000;

/** Everything the new-month action is about to delete or reset, in one workbook. */
export async function buildNewMonthExport(clientId: string): Promise<{ buffer: Buffer; clientName: string } | null> {
  const plan = await planNewMonth(clientId);
  if (!plan) return null;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WellcashOps';
  workbook.created = new Date();

  const summary = workbook.addWorksheet('Summary');
  header(summary, [
    { header: 'Item', key: 'k', width: 46 },
    { header: 'Value', key: 'v', width: 24 },
  ]);
  summary.addRows([
    { k: 'Client', v: plan.clientName },
    { k: 'Exported at', v: new Date().toISOString() },
    { k: 'Reconciliations received before', v: plan.cutoff.toISOString() },
    { k: 'Reconciliations cleared', v: plan.reconciliations.length },
    { k: 'Payments (entries) cleared', v: plan.entryCount },
    { k: 'Recovered by cleared reconciliations', v: plan.recoveredTotal },
    { k: 'Zero-balance debtors removed', v: plan.clearedDebtorCount },
    { k: 'Debtors on the books now', v: plan.debtorCount },
    { k: 'Total outstanding (carried forward)', v: plan.outstandingTotal },
  ]);

  const recons = workbook.addWorksheet('Reconciliations');
  header(recons, [
    { header: 'ID', key: 'id', width: 28 },
    { header: 'Batch', key: 'batch', width: 36 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Received', key: 'receivedAt', width: 22 },
    { header: 'Records', key: 'recordCount', width: 10 },
    { header: 'Updated', key: 'updatedCount', width: 10 },
    { header: 'New accounts', key: 'newAccountsCount', width: 14 },
    { header: 'Total paid', key: 'totalUpdated', width: 16 },
  ]);
  for (const r of plan.reconciliations) recons.addRow({ ...r, batch: r.batchLabel ?? '' });

  const payments = workbook.addWorksheet('Payments');
  header(payments, [
    { header: 'Reconciliation', key: 'recon', width: 28 },
    { header: 'Received', key: 'receivedAt', width: 22 },
    { header: 'Loan ref', key: 'loanRef', width: 16 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Batch', key: 'batch', width: 36 },
    { header: 'Old balance', key: 'oldBalance', width: 14 },
    { header: 'New balance', key: 'newBalance', width: 14 },
    { header: 'Paid', key: 'paid', width: 14 },
    { header: 'Payment date', key: 'paidDate', width: 22 },
  ]);
  for (let cursor: string | undefined; ; ) {
    const page = await prisma.reconciliationEntry.findMany({
      where: { reconciliation: { clientId, receivedAt: { lt: plan.cutoff } } },
      include: { reconciliation: { select: { receivedAt: true } }, debtor: { select: { loanRef: true, name: true, phone1: true, file: { select: { batchLabel: true } } } } },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (page.length === 0) break;
    for (const e of page) {
      payments.addRow({
        recon: e.reconciliationId,
        receivedAt: e.reconciliation.receivedAt,
        loanRef: e.debtor.loanRef,
        name: e.debtor.name,
        phone: e.debtor.phone1,
        batch: e.debtor.file.batchLabel,
        oldBalance: e.oldBalance,
        newBalance: e.newBalance,
        paid: e.paidAmount,
        paidDate: e.paidDate,
      });
    }
    cursor = page[page.length - 1].id;
  }

  const cleared = workbook.addWorksheet('Debtors removed');
  header(cleared, [
    { header: 'Loan ref', key: 'loanRef', width: 16 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Batch', key: 'batch', width: 36 },
    { header: 'Agent', key: 'agent', width: 24 },
    { header: 'Amount owed', key: 'amountOwed', width: 14 },
    { header: 'Paid', key: 'paid', width: 14 },
    { header: 'Calls logged', key: 'calls', width: 12 },
  ]);
  const outstanding = workbook.addWorksheet('Outstanding (carried forward)');
  header(outstanding, [
    { header: 'Loan ref', key: 'loanRef', width: 16 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Batch', key: 'batch', width: 36 },
    { header: 'Agent', key: 'agent', width: 24 },
    { header: 'Balance', key: 'balance', width: 14 },
  ]);
  for (let cursor: string | undefined; ; ) {
    const page = await prisma.debtor.findMany({
      where: { file: { clientId } },
      select: {
        id: true, loanRef: true, name: true, phone1: true, amountOwed: true, cumulativePaid: true, balance: true,
        file: { select: { batchLabel: true } },
        assignedAgent: { select: { name: true } },
        _count: { select: { callLogs: true } },
        reconciliationEntries: { where: { reconciliation: { receivedAt: { gte: plan.cutoff } } }, select: { id: true }, take: 1 },
      },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (page.length === 0) break;
    for (const d of page) {
      const base = { loanRef: d.loanRef, name: d.name, phone: d.phone1, batch: d.file.batchLabel, agent: d.assignedAgent?.name ?? '' };
      if (d.balance <= CLEARED) {
        if (d.reconciliationEntries.length === 0) {
          cleared.addRow({ ...base, amountOwed: d.amountOwed, paid: d.cumulativePaid, calls: d._count.callLogs });
        }
      } else {
        outstanding.addRow({ ...base, balance: d.balance });
      }
    }
    cursor = page[page.length - 1].id;
  }

  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), clientName: plan.clientName };
}

/** Every call (disposition) logged against one file's debtors — taken before they are cleared. */
export async function buildDispositionsExport(fileId: string): Promise<{ buffer: Buffer; label: string } | null> {
  const file = await prisma.file.findUnique({ where: { id: fileId }, select: { batchLabel: true, client: { select: { name: true } } } });
  if (!file) return null;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WellcashOps';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Dispositions');
  header(sheet, [
    { header: 'Loan ref', key: 'loanRef', width: 16 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Agent', key: 'agent', width: 24 },
    { header: 'Disposition', key: 'code', width: 18 },
    { header: 'Note', key: 'note', width: 50 },
    { header: 'Promised amount', key: 'promisedAmount', width: 16 },
    { header: 'Promised date', key: 'promisedDate', width: 22 },
    { header: 'Logged at', key: 'createdAt', width: 22 },
  ]);
  for (let cursor: string | undefined; ; ) {
    const page = await prisma.callLog.findMany({
      where: { debtor: { fileId } },
      include: { debtor: { select: { loanRef: true, name: true, phone1: true } }, agent: { select: { name: true } } },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (page.length === 0) break;
    for (const c of page) {
      sheet.addRow({
        loanRef: c.debtor.loanRef,
        name: c.debtor.name,
        phone: c.debtor.phone1,
        agent: c.agent.name,
        code: c.dispositionCode,
        note: c.note ?? '',
        promisedAmount: c.promisedAmount,
        promisedDate: c.promisedDate,
        createdAt: c.createdAt,
      });
    }
    cursor = page[page.length - 1].id;
  }

  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), label: `${file.client.name}-${file.batchLabel}` };
}
