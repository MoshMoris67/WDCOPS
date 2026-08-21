import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import * as XLSX from 'xlsx';

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const SUPPORTED_IMPORT_EXTENSIONS = ['.xlsx', '.xlsb', '.csv'];

function isCsv(filename: string): boolean {
  return filename.toLowerCase().endsWith('.csv');
}

function isXlsb(filename: string): boolean {
  return filename.toLowerCase().endsWith('.xlsb');
}

/**
 * Single-pass RFC4180-ish CSV tokenizer — quoted fields, "" as an escaped
 * quote, \n or \r\n line endings. exceljs's `workbook.csv.read()` builds a
 * full styled Workbook/Row/Cell object per cell (it's designed around
 * Excel's rich format, not flat text), which measured at ~3 seconds per
 * 1,000 rows — a real client file of tens of thousands of rows turns that
 * into minutes. This does the same job in a single string scan with no
 * per-cell object allocation.
 */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r') { /* skip — \n (bare or after \r) ends the row */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cellFromXlsxValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value) return String((value as { text: unknown }).text).trim();
    if ('result' in value) return String((value as { result: unknown }).result ?? '').trim();
  }
  return String(value).trim();
}

/**
 * Reads every sheet of an .xlsx workbook via exceljs's streaming reader rather than
 * `workbook.xlsx.load()`'s full DOM build — confirmed ~2.3x faster on a real 77,217-row
 * file (14.5s vs 34s locally), which matters because this is the path a background worker
 * tick runs to parse a newly-uploaded file (see lib/file-import.ts): a slow enough parse
 * here risks the tick itself running long enough for Render's own proxy to kill the
 * connection before the parse ever finishes (confirmed happening in production — a 2m31s
 * tick came back as a 502). `styles: 'cache'` matters and isn't the default: without it
 * exceljs can't tell a date-formatted numeric cell from a plain number and returns the
 * raw Excel serial instead — see previewXlsxFast below, where this was first verified
 * correct against real data (zero mismatches vs. the old DOM approach on 77,217 rows).
 */
async function streamXlsxTable(buffer: ArrayBuffer): Promise<string[][][]> {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([Buffer.from(buffer)]), {
    styles: 'cache',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    worksheets: 'emit',
  });

  const sheets: string[][][] = [];
  for await (const worksheetReader of workbookReader) {
    const rows: string[][] = [];
    for await (const row of worksheetReader) {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cellFromXlsxValue(cell.value)));
      rows.push(cells);
    }
    sheets.push(rows);
  }
  return sheets;
}

function rowsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((cell, i) => cell.trim().toLowerCase() === (b[i] ?? '').trim().toLowerCase());
}

/** Appends every sheet's rows after the first, using the first sheet's header as
 * canonical — a later sheet that repeats that header verbatim has it dropped as a
 * duplicate rather than imported as a debtor. Shared by both the .xlsx and .xlsb
 * loaders below: a client splitting one roster across tabs (row-limit workaround)
 * and a client splitting one roster into aging-bucket tabs (30-59 days, 60-89, ...,
 * seen in a real .xlsb reconciliation file) both want the same flattened result. */
function mergeSheets(sheets: string[][][]): string[][] {
  const [firstSheet, ...restSheets] = sheets;
  if (!firstSheet) return [];
  const rows = [...firstSheet];
  const headerRow = rows[0];

  for (const sheetRows of restSheets) {
    if (sheetRows.length === 0) continue;
    const startsWithRepeatedHeader = headerRow && rowsMatch(sheetRows[0], headerRow);
    rows.push(...sheetRows.slice(startsWithRepeatedHeader ? 1 : 0));
  }

  return rows;
}

function cellFromXlsbValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return String(value);
  return String(value).trim();
}

/** .xlsb (Excel Binary Workbook) isn't a zip/XML format like .xlsx — exceljs can't read
 * it at all — so this goes through SheetJS instead, which supports both. `raw: true` +
 * `cellDates: true` and manual string conversion (matching cellFromXlsxValue's approach
 * for the .xlsx path) keeps numeric precision exact rather than trusting a locale-aware
 * display-formatted string, which matters for financial columns. */
function loadXlsbTable(buffer: ArrayBuffer): string[][] {
  const workbook = XLSX.read(Buffer.from(buffer), { type: 'buffer', cellDates: true, raw: true });
  if (workbook.SheetNames.length === 0) throw new Error('The workbook has no sheets');

  const sheets = workbook.SheetNames.map((name) => {
    const json = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: '' });
    return json.map((row) => row.map(cellFromXlsbValue));
  });

  return mergeSheets(sheets);
}

/**
 * Loads any supported file into a plain table (row 0 = header) — .xlsx via exceljs's
 * streaming reader, .xlsb via SheetJS, .csv via the fast tokenizer above.
 */
export async function loadTable(buffer: ArrayBuffer, filename: string): Promise<string[][]> {
  if (isCsv(filename)) {
    return parseCsvText(Buffer.from(buffer).toString('utf8'));
  }
  if (isXlsb(filename)) {
    return loadXlsbTable(buffer);
  }
  const sheets = await streamXlsxTable(buffer);
  if (sheets.length === 0) throw new Error('The workbook has no sheets');

  return mergeSheets(sheets);
}

/**
 * Header + a handful of sample rows from the first sheet only, via exceljs's streaming
 * reader instead of `loadTable`'s full `workbook.xlsx.load()` — for the mapping-preview
 * step we only ever show 5 rows, so there's no reason to pay for parsing all 77,000 of
 * them (measured 6-10s locally, and apparently much worse on Render's free-tier CPU —
 * that's the "Reading columns... then Could not reach server" hang). Breaking out of the
 * for-await loop after the sample stops the reader from pulling any more of the file.
 *
 * `styles: 'cache'` matters and isn't the default: without it exceljs can't tell a
 * date-formatted numeric cell from a plain number, and returns the raw Excel serial
 * (e.g. "45912") instead of a real date — confirmed the hard way against this file's
 * actual date columns, and confirmed fixed by this option (zero mismatches against a
 * full DOM parse of the same rows).
 */
async function previewXlsxFast(buffer: ArrayBuffer, sampleCount = 5): Promise<{ headers: string[]; sampleRows: string[][] }> {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([Buffer.from(buffer)]), {
    styles: 'cache',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    worksheets: 'emit',
  });

  let headers: string[] = [];
  const sampleRows: string[][] = [];

  for await (const worksheetReader of workbookReader) {
    let rowCount = 0;
    for await (const row of worksheetReader) {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cellFromXlsxValue(cell.value)));
      rowCount++;
      if (rowCount === 1) headers = cells;
      else sampleRows.push(cells);
      if (rowCount > sampleCount) break;
    }
    break; // first sheet only — matches loadTable's/preview's existing "first sheet is canonical" behavior
  }

  return { headers, sampleRows };
}

function headerColumnMap(headerRow: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((cell, i) => map.set(normalizeHeader(cell), i));
  return map;
}

function cellText(row: string[], col: number | undefined): string {
  if (col === undefined) return '';
  return (row[col] ?? '').trim();
}

function cellNumber(row: string[], col: number | undefined): number | null {
  const text = cellText(row, col).replace(/,/g, '');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Column mapping — every client sends debtor files with their own headers
// (a loan-management system's "LOANID/MSISDN/CUSTOMERNAME/TOTAL_OUT", a
// telco's "TXN_ID/AIRTEL_PHONE_LINES/FIRST_NAME/LAST_NAME", a bank's
// "FORACID/ACCT_NAME/PHONE/LOAN_BAL", etc.). The synonym lists below cover
// the common cases automatically; ImportMapping lets an admin confirm or
// override the match by hand for anything the list doesn't anticipate —
// that manual path is the one guaranteed to keep working on a client's next,
// differently-shaped file, not just the ones seen so far.
// ---------------------------------------------------------------------------

export interface ImportMapping {
  nameCol?: number;
  firstNameCol?: number;
  lastNameCol?: number;
  middleNameCol?: number;
  phone1Col?: number;
  phone2Col?: number;
  loanRefCol?: number;
  amountOwedCol?: number;
  balanceCol?: number;
}

const SYNONYMS = {
  name: ['name', 'customername', 'clientname', 'accountholdername', 'borrowername', 'acctname', 'contactname', 'fullname'],
  firstName: ['firstname', 'fname', 'givenname'],
  lastName: ['lastname', 'lname', 'surname'],
  middleName: ['middlename', 'othername', 'mname'],
  phone: [
    'phone', 'phone1', 'phonenumber', 'msisdn', 'mobilephone', 'mobile', 'tel', 'telno',
    'contact', 'clientcontact', 'phonelines', 'primaryphone', 'mobileno', 'contactnumber',
  ],
  phone2: ['phone2', 'secondaryphone', 'altphone', 'alternatephone', 'nokcontact'],
  loanRef: [
    'loanref', 'loanreference', 'loanid', 'loannum', 'loannumber', 'loanaccountnumber',
    'accountid', 'acctno', 'accountno', 'txnid', 'foracid', 'cifid', 'accountnum', 'loanacno',
  ],
  amountOwed: [
    'amountowed', 'amount', 'loanamount', 'disbursedamount', 'disbamt', 'disbursedamt',
    'principal', 'principaloutstanding', 'disbursedamc',
  ],
  balance: [
    'balance', 'bal', 'loanbal', 'outstandingbalance', 'totaloutstanding', 'currentbalance',
    'principalbalance', 'clrbal', 'totaldue', 'totalout', 'loanbalance',
  ],
  amountPaid: [
    'amountpaid', 'paidamount', 'paid', 'amtpaid', 'paymentamount', 'totalpaid',
    'paymentreceived', 'amountreceived', 'repayment', 'repaymentamount',
  ],
  cumulativePaid: [
    'cumulativepaid', 'cumpaid', 'totalpaid', 'runningpaid', 'totalpaidtodate',
    'totalrepaid', 'aggregatepaid',
  ],
} as const;

function findColumn(cols: Map<string, number>, synonyms: readonly string[]): number | undefined {
  for (const s of synonyms) {
    const i = cols.get(s);
    if (i !== undefined) return i;
  }
  return undefined;
}

// Substring fallback for when no header matches the exact-synonym list — e.g. a
// client's own "AIRTEL_PHONE_LINES" or a header truncated in whatever tool produced
// the file. Only a fallback, and only for fields where a loose match is safe: this is
// always a suggestion the admin confirms in the mapping UI before anything imports,
// never applied silently, so an imprecise guess costs a click to fix, not bad data.
function findColumnFuzzy(cols: Map<string, number>, substrings: readonly string[]): number | undefined {
  for (const [header, index] of cols) {
    if (substrings.some((s) => header.includes(s))) return index;
  }
  return undefined;
}

/** Best-effort auto-detect from a header row — a starting point for the admin to confirm/adjust, not a guarantee. */
export function suggestImportMapping(headers: string[]): ImportMapping {
  const cols = headerColumnMap(headers);

  // First/last (+middle) has to be resolved before the single "name" fuzzy fallback —
  // otherwise a fuzzy substring match on 'name' could grab "FIRST_NAME" itself as if it
  // were a single full-name column, silently dropping the last name.
  const firstNameCol = findColumn(cols, SYNONYMS.firstName);
  const lastNameCol = findColumn(cols, SYNONYMS.lastName);
  const middleNameCol = findColumn(cols, SYNONYMS.middleName);
  const hasSplitName = firstNameCol !== undefined || lastNameCol !== undefined;
  const nameCol = findColumn(cols, SYNONYMS.name) ?? (hasSplitName ? undefined : findColumnFuzzy(cols, ['name']));

  const phone1Col = findColumn(cols, SYNONYMS.phone) ?? findColumnFuzzy(cols, ['phone', 'mobile', 'tel', 'msisdn', 'contact']);
  const phone2Col = findColumn(cols, SYNONYMS.phone2);
  const loanRefCol = findColumn(cols, SYNONYMS.loanRef);
  const balanceCol = findColumn(cols, SYNONYMS.balance);
  const amountOwedCol = findColumn(cols, SYNONYMS.amountOwed) ?? balanceCol;

  return { nameCol, firstNameCol, lastNameCol, middleNameCol, phone1Col, phone2Col, loanRefCol, amountOwedCol, balanceCol };
}

export interface FilePreview {
  headers: string[];
  sampleRows: string[][];
  suggested: ImportMapping;
  /** null for .xlsx — an exact count needs a full parse (confirmed as slow as loading the
   * whole file, so not worth doing just to display a number); still exact for .csv, since
   * the fast tokenizer already parses the whole file in well under a second either way. */
  totalRows: number | null;
}

/** Parses just enough of the file to show a mapping-confirmation step — headers, a few sample rows, and a best-guess mapping.
 * .xlsx uses the early-stopping streaming path (see previewXlsxFast). .csv and .xlsb both already parse a real
 * multi-tens-of-thousands-row file in well under a second (the tokenizer, and SheetJS's binary decoder,
 * respectively — confirmed by direct testing), so there's no equivalent early-stop path built for either. */
export async function previewImportFile(buffer: ArrayBuffer, filename: string): Promise<FilePreview> {
  if (isXlsb(filename)) {
    const table = loadXlsbTable(buffer);
    const headers = table[0] ?? [];
    return {
      headers,
      sampleRows: table.slice(1, 6),
      suggested: suggestImportMapping(headers),
      totalRows: Math.max(0, table.length - 1),
    };
  }
  if (isCsv(filename)) {
    const table = await loadTable(buffer, filename);
    const headers = table[0] ?? [];
    return {
      headers,
      sampleRows: table.slice(1, 6),
      suggested: suggestImportMapping(headers),
      totalRows: Math.max(0, table.length - 1),
    };
  }
  const { headers, sampleRows } = await previewXlsxFast(buffer);
  return { headers, sampleRows, suggested: suggestImportMapping(headers), totalRows: null };
}

export interface ImportRow {
  rowNumber: number;
  name: string;
  phone1: string;
  phone2: string | null;
  loanRef: string;
  amountOwed: number;
  balance: number | null;
}

export interface ParseResult<T> {
  rows: T[];
  errors: string[];
}

function nameFromMapping(row: string[], mapping: ImportMapping): string {
  if (mapping.nameCol !== undefined) return cellText(row, mapping.nameCol);
  const parts = [mapping.firstNameCol, mapping.middleNameCol, mapping.lastNameCol]
    .map((c) => cellText(row, c))
    .filter(Boolean);
  return parts.join(' ');
}

function requiredMappingError(mapping: ImportMapping): string | null {
  const hasName = mapping.nameCol !== undefined || mapping.firstNameCol !== undefined || mapping.lastNameCol !== undefined;
  const missing: string[] = [];
  if (!hasName) missing.push('Name');
  if (mapping.phone1Col === undefined) missing.push('Phone');
  if (mapping.loanRefCol === undefined) missing.push('Loan Ref');
  if (mapping.amountOwedCol === undefined) missing.push('Amount Owed');
  return missing.length > 0 ? `Missing column(s) for: ${missing.join(', ')}.` : null;
}

/**
 * Parses debtor rows from a pre-loaded table using a confirmed column mapping — either
 * auto-detected (see suggestImportMapping) or hand-picked by the admin in the import
 * modal after reviewing a preview, which is the part that keeps working on a client's
 * next file even if it doesn't match any header pattern seen before.
 */
export function parseImportRows(table: string[][], mapping: ImportMapping): ParseResult<ImportRow> {
  const mappingError = requiredMappingError(mapping);
  if (mappingError) return { rows: [], errors: [mappingError] };

  const errors: string[] = [];
  const rows: ImportRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    const rowNumber = i + 1; // spreadsheet-style: row 1 is the header
    const name = nameFromMapping(row, mapping);
    const phone1 = cellText(row, mapping.phone1Col);
    const loanRef = cellText(row, mapping.loanRefCol);
    const amountOwed = cellNumber(row, mapping.amountOwedCol);
    if (!name && !phone1 && !loanRef) continue; // blank row

    if (!name || !phone1 || !loanRef || amountOwed === null) {
      errors.push(`Row ${rowNumber}: missing or invalid name/phone/loan ref/amount owed — skipped`);
      continue;
    }
    const balance = mapping.balanceCol !== undefined ? cellNumber(row, mapping.balanceCol) : null;
    rows.push({
      rowNumber,
      name,
      phone1,
      phone2: mapping.phone2Col !== undefined ? cellText(row, mapping.phone2Col) || null : null,
      loanRef,
      amountOwed,
      balance,
    });
  }

  return { rows, errors };
}

/** Convenience wrapper for when no explicit mapping is confirmed — loads the table and auto-detects. */
export async function parseImportWorkbook(buffer: ArrayBuffer, filename: string): Promise<ParseResult<ImportRow>> {
  const table = await loadTable(buffer, filename);
  const mapping = suggestImportMapping(table[0] ?? []);
  return parseImportRows(table, mapping);
}

export interface ReconciliationRow {
  rowNumber: number;
  loanRef: string | null;
  phone: string | null;
  amount: number;
  /** Present only when the row also carries new-account columns (name/amount owed) — a client
   * can send reconciliations and mid-file top-ups in the same file; a row that doesn't match an
   * existing debtor but has these becomes a new account instead of an unmatched-row warning. */
  name: string | null;
  amountOwed: number | null;
}

export interface ReconciliationMapping {
  loanRefCol?: number;
  phoneCol?: number;
  /** Amount Paid (partial) or Cumulative Paid (full) — whichever the client's file calls it. */
  amountCol?: number;
  nameCol?: number;
  amountOwedCol?: number;
}

/** Best-effort auto-detect from a header row — same idea as suggestImportMapping: a starting
 * point for the admin to confirm/adjust in the mapping UI, not a guarantee. */
export function suggestReconciliationMapping(headers: string[], type: 'full' | 'partial'): ReconciliationMapping {
  const cols = headerColumnMap(headers);

  const loanRefCol = findColumn(cols, SYNONYMS.loanRef);
  const phoneCol = findColumn(cols, SYNONYMS.phone) ?? findColumnFuzzy(cols, ['phone', 'mobile', 'tel', 'msisdn', 'contact']);
  const amountCol = type === 'full'
    ? findColumn(cols, SYNONYMS.cumulativePaid) ?? findColumn(cols, SYNONYMS.amountPaid)
    : findColumn(cols, SYNONYMS.amountPaid) ?? findColumn(cols, SYNONYMS.cumulativePaid);
  const nameCol = findColumn(cols, SYNONYMS.name) ?? findColumnFuzzy(cols, ['name']);
  const amountOwedCol = findColumn(cols, SYNONYMS.amountOwed);

  return { loanRefCol, phoneCol, amountCol, nameCol, amountOwedCol };
}

export interface ReconciliationPreview {
  headers: string[];
  sampleRows: string[][];
  suggested: ReconciliationMapping;
  /** See FilePreview.totalRows — same tradeoff, same reasoning. */
  totalRows: number | null;
}

/** Parses just enough of the file to show a mapping-confirmation step — mirrors previewImportFile. */
export async function previewReconciliationFile(buffer: ArrayBuffer, filename: string, type: 'full' | 'partial'): Promise<ReconciliationPreview> {
  if (isXlsb(filename)) {
    const table = loadXlsbTable(buffer);
    const headers = table[0] ?? [];
    return {
      headers,
      sampleRows: table.slice(1, 6),
      suggested: suggestReconciliationMapping(headers, type),
      totalRows: Math.max(0, table.length - 1),
    };
  }
  if (isCsv(filename)) {
    const table = await loadTable(buffer, filename);
    const headers = table[0] ?? [];
    return {
      headers,
      sampleRows: table.slice(1, 6),
      suggested: suggestReconciliationMapping(headers, type),
      totalRows: Math.max(0, table.length - 1),
    };
  }
  const { headers, sampleRows } = await previewXlsxFast(buffer);
  return { headers, sampleRows, suggested: suggestReconciliationMapping(headers, type), totalRows: null };
}

/**
 * Parses reconciliation rows from a pre-loaded table using a confirmed column mapping — either
 * auto-detected (see suggestReconciliationMapping) or hand-picked by the admin after reviewing
 * a preview, the same pattern parseImportRows uses so a reconciliation file with unfamiliar
 * headers doesn't just fail with "no valid rows found."
 */
export function parseReconciliationRows(table: string[][], mapping: ReconciliationMapping, type: 'full' | 'partial'): ParseResult<ReconciliationRow> {
  const { loanRefCol, phoneCol, amountCol, nameCol, amountOwedCol } = mapping;

  const errors: string[] = [];
  if (loanRefCol === undefined && phoneCol === undefined) {
    errors.push('Missing required column(s). Expected Loan Ref or Phone to match against.');
    return { rows: [], errors };
  }
  if (amountCol === undefined && (nameCol === undefined || amountOwedCol === undefined)) {
    errors.push(
      `File needs either ${type === 'full' ? 'Cumulative Paid' : 'Amount Paid'} (to reconcile existing debtors) or Name + Amount Owed (to add new accounts), or both.`
    );
    return { rows: [], errors };
  }

  const rows: ReconciliationRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    const rowNumber = i + 1; // spreadsheet-style: row 1 is the header
    const loanRef = loanRefCol !== undefined ? cellText(row, loanRefCol) || null : null;
    const phone = phoneCol !== undefined ? cellText(row, phoneCol) || null : null;
    if (!loanRef && !phone) continue; // blank row

    const amount = amountCol !== undefined ? cellNumber(row, amountCol) : null;
    const name = nameCol !== undefined ? cellText(row, nameCol) || null : null;
    const amountOwed = amountOwedCol !== undefined ? cellNumber(row, amountOwedCol) : null;

    if (amount === null && !(name && phone && amountOwed !== null)) {
      errors.push(`Row ${rowNumber}: no payment amount, and not enough info (name, phone, amount owed) to add as a new account — skipped`);
      continue;
    }
    rows.push({ rowNumber, loanRef, phone, amount: amount ?? 0, name, amountOwed });
  }

  return { rows, errors };
}

/** Convenience wrapper for when no explicit mapping is confirmed — loads the table and auto-detects. */
export async function parseReconciliationWorkbook(
  buffer: ArrayBuffer,
  type: 'full' | 'partial',
  filename: string
): Promise<ParseResult<ReconciliationRow>> {
  const table = await loadTable(buffer, filename);
  const mapping = suggestReconciliationMapping(table[0] ?? [], type);
  return parseReconciliationRows(table, mapping, type);
}

export async function buildReportWorkbook(input: {
  clientName: string;
  frequency: string;
  from: string;
  to: string;
  summary: { label: string; value: string | number }[];
  dispositions: { code: string; label: string; count: number }[];
  agents: { name: string; calls: number; ptps: number; recovered: number }[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WellcashOps';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'label', width: 28 },
    { header: 'Value', key: 'value', width: 20 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.addRow({ label: 'Client', value: input.clientName });
  summarySheet.addRow({ label: 'Frequency', value: input.frequency });
  summarySheet.addRow({ label: 'Date range', value: `${input.from} to ${input.to}` });
  summarySheet.addRow({});
  input.summary.forEach((row) => summarySheet.addRow(row));

  const dispoSheet = workbook.addWorksheet('Dispositions');
  dispoSheet.columns = [
    { header: 'Code', key: 'code', width: 10 },
    { header: 'Disposition', key: 'label', width: 26 },
    { header: 'Count', key: 'count', width: 12 },
  ];
  dispoSheet.getRow(1).font = { bold: true };
  input.dispositions.forEach((row) => dispoSheet.addRow(row));

  const agentSheet = workbook.addWorksheet('Agent Performance');
  agentSheet.columns = [
    { header: 'Agent', key: 'name', width: 24 },
    { header: 'Calls Logged', key: 'calls', width: 14 },
    { header: 'PTPs', key: 'ptps', width: 10 },
    { header: 'Recovered (UGX)', key: 'recovered', width: 18 },
  ];
  agentSheet.getRow(1).font = { bold: true };
  input.agents.forEach((row) => agentSheet.addRow(row));

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
