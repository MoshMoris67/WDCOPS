import { prisma } from './db';
import { loadTable, parseImportRows, type ImportRow, type ImportMapping } from './excel';

// One INSERT per this many rows, not one giant statement for the whole file — keeps any
// single query lightweight regardless of file size, and means File.debtorCount (already
// polled by FileManagementContent.tsx) climbs progressively as each batch lands, so the
// UI shows real import progress with no extra field needed for that specifically.
const BATCH_SIZE = 1000;

export interface ImportTickResult {
  fileId: string;
  inserted: number;
  done: boolean;
}

/**
 * Parses the file if that hasn't happened yet, then inserts as many rows as fit in the
 * given time budget, resuming from wherever the file left off (File.rowsProcessed) rather
 * than starting over — called once per scheduled cron tick (see POST /api/worker/tick),
 * repeatedly, until the whole file is done. Never tries to finish a large file in a
 * single call: that's exactly what used to time out a request regardless of who triggers
 * it — a browser upload or a cron hitting this same web service, since both ultimately
 * run inside the same request-response cycle on the same host. Insert progress is written
 * back after every batch, not just at the end, so a tick that gets cut off mid-way (e.g.
 * the host itself enforces a hard timeout shorter than the soft budget below) leaves
 * rowsProcessed accurate — the next tick just continues, never re-inserting or losing
 * rows.
 */
export async function processFileImportTick(fileId: string, timeBudgetMs = 20000): Promise<ImportTickResult> {
  const started = Date.now();
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file) return { fileId, inserted: 0, done: true };

  let cursor = file.rowsProcessed;
  let inserted = 0;

  try {
    let rawRows = file.rawRows;

    // First tick for this file: nothing parsed yet. Unlike insertion below, parsing can't
    // be split across ticks — there's no cheap way to resume a spreadsheet parse partway
    // through (confirmed by direct timing: skipping rows costs as much as reading them) —
    // so it runs to completion in one go here. The caller (api/worker/tick/route.ts) calls
    // this fire-and-forget rather than awaiting it specifically because of this step: even
    // off the browser, a slow enough parse can outlast Render's own inbound request
    // timeout and get the *tick's* response killed (confirmed in production — a stuck
    // 'queued' file, tick logs showing a 502 after 2+ minutes). Not awaited means no
    // timeout applies to it at all; it keeps running against this same long-lived process
    // after the tick's HTTP response has already gone out.
    if (!rawRows) {
      if (!file.rawFile || !file.rawFileName) {
        await prisma.file.update({
          where: { id: fileId },
          data: { importStatus: 'failed', importError: 'No stored file to import — the upload may have been interrupted, re-import the file', parsingStartedAt: null },
        });
        return { fileId, inserted: 0, done: true };
      }
      const mapping: ImportMapping = file.importMapping ? JSON.parse(file.importMapping) : {};
      const raw = Buffer.from(file.rawFile, 'base64');
      const table = await loadTable(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), file.rawFileName);
      const { rows: parsedRows, errors } = parseImportRows(table, mapping);
      if (parsedRows.length === 0) {
        await prisma.file.update({
          where: { id: fileId },
          data: { importStatus: 'failed', importError: errors[0] ?? 'No valid debtor rows found in the file', parsingStartedAt: null },
        });
        return { fileId, inserted: 0, done: true };
      }
      rawRows = JSON.stringify(parsedRows);
      await prisma.file.update({
        where: { id: fileId },
        data: {
          rawRows,
          importWarnings: errors.length > 0 ? JSON.stringify(errors) : null,
          rawFile: null, // no longer needed once parsed — no reason to keep megabytes of base64 around
          parsingStartedAt: null,
        },
      });
    }

    const rows: ImportRow[] = JSON.parse(rawRows);

    while (cursor < rows.length && Date.now() - started < timeBudgetMs) {
      const batch = rows.slice(cursor, cursor + BATCH_SIZE);
      await prisma.debtor.createMany({
        data: batch.map((r) => {
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
          };
        }),
      });
      cursor += batch.length;
      inserted += batch.length;
      await prisma.file.update({ where: { id: fileId }, data: { importStatus: 'processing', rowsProcessed: cursor } });
    }

    const done = cursor >= rows.length;
    if (done) {
      await prisma.file.update({ where: { id: fileId }, data: { importStatus: 'complete' } });
    }
    return { fileId, inserted, done };
  } catch (err) {
    await prisma.file
      .update({
        where: { id: fileId },
        data: { importStatus: 'failed', importError: err instanceof Error ? err.message : 'Import failed', rowsProcessed: cursor, parsingStartedAt: null },
      })
      .catch(() => {});
    return { fileId, inserted, done: true };
  }
}
