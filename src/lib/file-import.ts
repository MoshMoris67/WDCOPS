import { prisma } from './db';
import {
  loadTable,
  loadTableWithSheetTags,
  parseImportRows,
  parseDistributedImportRows,
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
  // Some clients' files carry the current outstanding balance separately from the
  // original amount owed (already-partly-repaid loans) — when they don't, balance
  // defaults to amountOwed, matching the standard-template behavior.
  const balance = r.balance ?? r.amountOwed;
  const cumulativePaid = Math.max(0, r.amountOwed - balance);
  return {
    fileId,
    name: r.name,
    phone1: r.phone1,
    phone2: r.phone2,
    loanRef: r.loanRef,
    amountOwed: r.amountOwed,
    cumulativePaid,
    balance,
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
 * Deliberately does NOT persist the parsed rows to File.rawRows and re-read them back for
 * a separate insert phase, the way an earlier version of this function did — that meant
 * holding the raw base64 string, the decoded buffer, the full parsed table, the full
 * ImportRow[], AND a JSON-stringified copy of it all in memory at overlapping points,
 * which measurably made peak memory *worse*, not better, when tested against the real
 * 77,000-row file (peak RSS ~650MB vs ~500MB for parsing straight into memory and
 * inserting immediately, without ever serializing rawRows at all). Both numbers are
 * uncomfortably close to Render's free-tier 512MB ceiling for a file this size — this is
 * the better of the two measured designs, not a confirmed fix for every file size; see
 * the commit message for the fuller picture and what a real fix would need if this still
 * isn't enough.
 *
 * Parsing can't be split into bounded chunks (no cheap way to resume a spreadsheet parse
 * partway through — confirmed by direct timing: skipping rows costs as much as reading
 * them), so this runs the whole file in one pass. If a prior attempt crashed partway
 * through inserting (rowsProcessed > 0 but importStatus never reached 'complete'), this
 * clears whatever it already inserted and starts over clean rather than trying to resume
 * — there's no materialized row array to resume a cursor into.
 */
export async function runFileImport(fileId: string): Promise<void> {
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file) return;

  try {
    if (!file.rawFile || !file.rawFileName) {
      await prisma.file.update({
        where: { id: fileId },
        data: { importStatus: 'failed', importError: 'No stored file to import — the upload may have been interrupted, re-import the file', parsingStartedAt: null },
      });
      return;
    }

    const mapping: ImportMapping = file.importMapping ? JSON.parse(file.importMapping) : {};
    const raw = Buffer.from(file.rawFile, 'base64');
    const bufferSlice = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

    let rows: (ImportRow & { assignedAgentId?: string | null })[];
    let errors: string[];
    if (file.isDistributedImport) {
      const sheetPlan: SheetPlan = file.sheetPlan ? JSON.parse(file.sheetPlan) : {};
      const { table, sheetTags } = await loadTableWithSheetTags(bufferSlice, file.rawFileName);
      ({ rows, errors } = parseDistributedImportRows(table, sheetTags, mapping, sheetPlan));
    } else {
      const table = await loadTable(bufferSlice, file.rawFileName);
      ({ rows, errors } = parseImportRows(table, mapping));
    }

    if (rows.length === 0) {
      await prisma.file.update({
        where: { id: fileId },
        data: { importStatus: 'failed', importError: errors[0] ?? 'No valid debtor rows found in the file', rawFile: null, parsingStartedAt: null },
      });
      return;
    }

    if (file.rowsProcessed > 0) {
      await prisma.debtor.deleteMany({ where: { fileId } });
    }

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map((r) => toDebtorData(fileId, r));
      await prisma.debtor.createMany({ data: batch });
      inserted += batch.length;
      await prisma.file.update({ where: { id: fileId }, data: { importStatus: 'processing', rowsProcessed: inserted } });
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
