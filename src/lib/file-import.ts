import { prisma } from './db';
import {
  iterateTable,
  mapImportRow,
  requiredMappingError,
  type ImportRow,
  type ImportMapping,
  type SheetPlan,
} from './excel';

// One INSERT per this many rows, not one giant statement for the whole file — keeps any
// single query lightweight regardless of file size, and means File.debtorCount (already
// polled by FileManagementContent.tsx) climbs progressively as each batch lands, so the
// UI shows real import progress with no extra field needed for that specifically.
const BATCH_SIZE = 1000;

function toDebtorData(fileId: string, r: ImportRow & { assignedAgentId?: string | null }) {
  // A freshly-imported debtor has zero recovery through this system, full stop — even
  // when the client's own file carries a separate "current balance" column that's
  // already lower than the amount owed (e.g. a balance net of accrued fees, or repayment
  // made before the account was ever handed to us). Treating that pre-existing gap as
  // "already recovered" was the previous behavior here, and it's wrong: it credits the
  // recovery dashboard with money nobody in this system collected. balance always starts
  // equal to amountOwed so the balance = amountOwed - cumulativePaid invariant (relied on
  // by reconciliation.ts and daily-sync.ts) holds true from day one; any real reduction in
  // balance is applied — and cumulativePaid incremented — only by an actual reconciliation
  // or daily-sync payment event afterward.
  return {
    fileId,
    name: r.name,
    phone1: r.phone1,
    phone2: r.phone2,
    loanRef: r.loanRef,
    amountOwed: r.amountOwed,
    cumulativePaid: 0,
    balance: r.amountOwed,
    // Undefined for a normal import (ImportRow has no such field) — same as never setting
    // it, debtor lands unassigned exactly as before. Only a distributed import supplies a
    // real value (an agent id, or explicit null for "leave unassigned").
    assignedAgentId: r.assignedAgentId ?? null,
  };
}

/**
 * Parses a file's raw upload and inserts every row, run once via Next's after() (see
 * api/worker/tick/route.ts) rather than resumable ticks.
 *
 * Uses iterateTable to stream the file row-by-row, avoiding holding the entire table
 * in memory. This is the primary fix for OOM issues on 512MB RAM hosts when processing
 * large (70k+ row) files.
 *
 * If a prior attempt crashed partway through inserting (rowsProcessed > 0 but
 * importStatus never reached 'complete'), this clears whatever it already inserted
 * and starts over clean rather than trying to resume.
 */
export async function runFileImport(fileId: string): Promise<void> {
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file) return;

  try {
    if (!file.rawFile || !file.rawFileName) {
      await prisma.file.update({
        where: { id: fileId },
        data: {
          importStatus: 'failed',
          importError: 'No stored file to import — the upload may have been interrupted, re-import the file',
          parsingStartedAt: null,
        },
      });
      return;
    }

    const mapping: ImportMapping = file.importMapping ? JSON.parse(file.importMapping) : {};
    const mappingError = requiredMappingError(mapping);
    if (mappingError) {
      await prisma.file.update({
        where: { id: fileId },
        data: { importStatus: 'failed', importError: mappingError, parsingStartedAt: null },
      });
      return;
    }

    const raw = Buffer.from(file.rawFile, 'base64');
    const bufferSlice = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

    const sheetPlan: SheetPlan = file.isDistributedImport && file.sheetPlan ? JSON.parse(file.sheetPlan) : {};

    if (file.rowsProcessed > 0) {
      await prisma.debtor.deleteMany({ where: { fileId } });
    }

    const errors: string[] = [];
    let batch: (ImportRow & { assignedAgentId?: string | null })[] = [];
    let inserted = 0;

    await iterateTable(bufferSlice, file.rawFileName, async (row, index, sheetName) => {
      if (index === 0) return; // Skip header

      const rowNumber = index + 1;
      let assignedAgentId: string | null = null;

      if (file.isDistributedImport) {
        const plan = sheetPlan[sheetName];
        if (!plan || plan.action === 'skip') return;
        assignedAgentId = plan.action === 'assign' ? plan.agentId : null;
      }

      const mapped = mapImportRow(row, mapping, rowNumber);
      if (mapped.kind === 'blank') return;
      if (mapped.kind === 'error') {
        if (errors.length < 500) errors.push(mapped.message);
        return;
      }

      batch.push({ ...mapped.row, assignedAgentId });

      if (batch.length >= BATCH_SIZE) {
        const data = batch.map((r) => toDebtorData(fileId, r));
        await prisma.debtor.createMany({ data });
        inserted += batch.length;
        batch = [];
        await prisma.file.update({
          where: { id: fileId },
          data: { importStatus: 'processing', rowsProcessed: inserted },
        });
      }
    });

    // Final batch
    if (batch.length > 0) {
      const data = batch.map((r) => toDebtorData(fileId, r));
      await prisma.debtor.createMany({ data });
      inserted += batch.length;
    }

    if (inserted === 0 && errors.length > 0) {
      throw new Error(errors[0]);
    }

    await prisma.file.update({
      where: { id: fileId },
      data: {
        importStatus: 'complete',
        importWarnings: errors.length > 0 ? JSON.stringify(errors.slice(0, 500)) : null,
        rawFile: null,
        parsingStartedAt: null,
      },
    });
  } catch (err) {
    await prisma.file
      .update({
        where: { id: fileId },
        data: { importStatus: 'failed', importError: err instanceof Error ? err.message : 'Import failed', parsingStartedAt: null },
      })
      .catch(() => {});
  }
}
