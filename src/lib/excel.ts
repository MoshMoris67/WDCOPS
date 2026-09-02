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
interface NamedSheet {
  name: string;
  rows: string[][];
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
 *
 * Sheet names are kept (not just rows) because some clients' files use the sheet itself
 * as a data field — e.g. KCB Mopesa's reconciliation exports have one sheet per aging
 * bucket ("30-59", "60-89", ...) with no bucket column at all. `worksheetReader.name` isn't
 * in exceljs's own .d.ts but is genuinely set at runtime (confirmed by reading
 * node_modules/exceljs/lib/stream/xlsx/workbook-reader.js) — hence the cast.
 */
async function streamXlsxSheets(buffer: ArrayBuffer): Promise<NamedSheet[]> {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([Buffer.from(buffer)]), {
    styles: 'cache',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    worksheets: 'emit',
  });

  const sheets: NamedSheet[] = [];
  for await (const worksheetReader of workbookReader) {
    const rows: string[][] = [];
    for await (const row of worksheetReader) {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cellFromXlsxValue(cell.value)));
      rows.push(cells);
    }
    const name = (worksheetReader as unknown as { name?: string }).name ?? `Sheet${sheets.length + 1}`;
    sheets.push({ name, rows });
  }
  return sheets;
}

function trimTrailingBlanks(row: string[]): string[] {
  const trimmed = [...row];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
  return trimmed;
}

/** Used only to detect a repeated header row on a later sheet (see mergeNamedSheets) — a
 * strict length + trim/lowercase check missed two real cases in the same real file: one
 * sheet's header had a trailing blank column the others didn't, and another sheet spelled
 * a header "MATURITY DATE" where the rest spelled it "MATURITYDATE". Neither was
 * recognized as the same header, so those rows got imported as three garbage debtor rows
 * (harmlessly skipped later for failing validation, but noisy and inflated the "rows
 * detected" count shown before import). Trailing blanks are dropped and every cell is run
 * through normalizeHeader (same normalization already used for column-mapping detection)
 * before comparing, so formatting/spacing differences no longer defeat the match. */
function rowsMatch(a: string[], b: string[]): boolean {
  const ta = trimTrailingBlanks(a);
  const tb = trimTrailingBlanks(b);
  if (ta.length !== tb.length) return false;
  return ta.every((cell, i) => normalizeHeader(cell) === normalizeHeader(tb[i] ?? ''));
}

/** Appends every sheet's rows after the first, using the first sheet's header as
 * canonical — a later sheet that repeats that header verbatim has it dropped as a
 * duplicate rather than imported as a debtor. Shared by both the .xlsx and .xlsb
 * loaders below: a client splitting one roster across tabs (row-limit workaround)
 * and a client splitting one roster into aging-bucket tabs (30-59 days, 60-89, ...,
 * seen in a real .xlsb reconciliation file) both want the same flattened result.
 * sheetTags[i] names which sheet table[i] came from — only consumed when a caller
 * actually needs it (loadTableWithSheetTags); loadTable just takes .table. */
function mergeNamedSheets(sheets: NamedSheet[]): { table: string[][]; sheetTags: string[] } {
  const table: string[][] = [];
  const sheetTags: string[] = [];
  const [firstSheet, ...restSheets] = sheets;
  if (!firstSheet) return { table, sheetTags };

  // Loop-appended, not `arr.push(...rows)` — a real client file had a sheet with over a
  // million rows (a phantom "used range" bloated far past its actual data, confirmed
  // separately), and spreading that many arguments into push() blows JS's call-stack
  // argument limit (RangeError: Maximum call stack size exceeded, confirmed by direct
  // testing against that exact file).
  for (const row of firstSheet.rows) {
    table.push(row);
    sheetTags.push(firstSheet.name);
  }
  const headerRow = firstSheet.rows[0];

  for (const sheet of restSheets) {
    if (sheet.rows.length === 0) continue;
    const startsWithRepeatedHeader = headerRow && rowsMatch(sheet.rows[0], headerRow);
    const start = startsWithRepeatedHeader ? 1 : 0;
    for (let i = start; i < sheet.rows.length; i++) {
      table.push(sheet.rows[i]);
      sheetTags.push(sheet.name);
    }
  }

  return { table, sheetTags };
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
function loadXlsbSheets(buffer: ArrayBuffer): NamedSheet[] {
  const workbook = XLSX.read(Buffer.from(buffer), { type: 'buffer', cellDates: true, raw: true });
  if (workbook.SheetNames.length === 0) throw new Error('The workbook has no sheets');

  return workbook.SheetNames.map((name) => {
    const json = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: '' });
    return { name, rows: json.map((row) => row.map(cellFromXlsbValue)) };
  });
}

/** Loads a file's sheets, tagged by name, for every supported format — .csv has no
 * concept of multiple sheets, so it's wrapped as a single pseudo-sheet named after the
 * file for interface consistency (a caller asking for sheet tags on a .csv just gets the
 * filename repeated for every row, which correctly canonicalizes to no bucket rather than
 * mispricing anything). */
async function loadNamedSheets(buffer: ArrayBuffer, filename: string): Promise<NamedSheet[]> {
  if (isCsv(filename)) {
    return [{ name: filename, rows: parseCsvText(Buffer.from(buffer).toString('utf8')) }];
  }
  if (isXlsb(filename)) {
    return loadXlsbSheets(buffer);
  }
  return streamXlsxSheets(buffer);
}

/**
 * Loads any supported file into a plain table (row 0 = header) — .xlsx via exceljs's
 * streaming reader, .xlsb via SheetJS, .csv via the fast tokenizer above.
 */
export async function loadTable(buffer: ArrayBuffer, filename: string): Promise<string[][]> {
  const sheets = await loadNamedSheets(buffer, filename);
  if (sheets.length === 0) throw new Error('The workbook has no sheets');
  return mergeNamedSheets(sheets).table;
}

/**
 * Same as loadTable, but also returns which sheet each row came from (sheetTags[i] is the
 * origin sheet name of table[i]) — for clients whose files use the sheet itself as a data
 * field (see lib/commission.ts: KCB Mopesa's reconciliation exports are one sheet per
 * aging bucket, no bucket column). Only worth the extra bookkeeping for callers that
 * actually need it, so loadTable stays the default for everything else.
 */
export async function loadTableWithSheetTags(buffer: ArrayBuffer, filename: string): Promise<{ table: string[][]; sheetTags: string[] }> {
  const sheets = await loadNamedSheets(buffer, filename);
  if (sheets.length === 0) throw new Error('The workbook has no sheets');
  return mergeNamedSheets(sheets);
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

const AMOUNT_PAID_FUZZY = ['paid', 'repay', 'collect', 'received', 'rept', 'cum'] as const;

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
    const table = mergeNamedSheets(loadXlsbSheets(buffer)).table;
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

export function requiredMappingError(mapping: ImportMapping): string | null {
  const hasName = mapping.nameCol !== undefined || mapping.firstNameCol !== undefined || mapping.lastNameCol !== undefined;
  const missing: string[] = [];
  if (!hasName) missing.push('Name');
  if (mapping.phone1Col === undefined) missing.push('Phone');
  if (mapping.loanRefCol === undefined) missing.push('Loan Ref');
  if (mapping.amountOwedCol === undefined) missing.push('Amount Owed');
  return missing.length > 0 ? `Missing column(s) for: ${missing.join(', ')}.` : null;
}

export type MappedRow = { kind: 'row'; row: ImportRow } | { kind: 'blank' } | { kind: 'error'; message: string };

/** One row's worth of parseImportRows' logic, pulled out so the streaming importer
 * (lib/file-import.ts) can apply the exact same rules one row at a time without ever
 * materializing the whole table into an ImportRow[] — see that file for why. */
export function mapImportRow(row: string[], mapping: ImportMapping, rowNumber: number): MappedRow {
  const name = nameFromMapping(row, mapping);
  const phone1 = cellText(row, mapping.phone1Col);
  const loanRef = cellText(row, mapping.loanRefCol);
  const amountOwed = cellNumber(row, mapping.amountOwedCol);
  if (!name && !phone1 && !loanRef) return { kind: 'blank' };

  if (!name || !phone1 || !loanRef || amountOwed === null) {
    return { kind: 'error', message: `Row ${rowNumber}: missing or invalid name/phone/loan ref/amount owed — skipped` };
  }
  const balance = mapping.balanceCol !== undefined ? cellNumber(row, mapping.balanceCol) : null;
  return {
    kind: 'row',
    row: {
      rowNumber,
      name,
      phone1,
      phone2: mapping.phone2Col !== undefined ? cellText(row, mapping.phone2Col) || null : null,
      loanRef,
      amountOwed,
      balance,
    },
  };
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
    const mapped = mapImportRow(table[i], mapping, i + 1);
    if (mapped.kind === 'blank') continue;
    if (mapped.kind === 'error') { errors.push(mapped.message); continue; }
    rows.push(mapped.row);
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
  /** The raw sheet name this row came from, when the caller loaded the file with
   * loadTableWithSheetTags — set for clients whose files use the sheet itself as a bucket
   * (see lib/commission.ts), null otherwise. Not a column value; independent of `mapping`. */
  bucketRaw: string | null;
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
  // Exact-synonym match first, same as everywhere else; the fuzzy fallback exists because
  // "amount paid" headers vary more than most — confirmed against a real client file whose
  // column was "Cumm. Rep'ts" (Cumulative Repayments, abbreviated), which doesn't match any
  // exact synonym and was silently left unmapped, letting every matched row through with a
  // $0 payment instead of what the file actually said. Kept narrow (not e.g. 'amount' alone,
  // which would collide with amountOwed/balance-style columns) — still just a suggestion the
  // admin confirms before anything is submitted.
  const amountCol = type === 'full'
    ? findColumn(cols, SYNONYMS.cumulativePaid) ?? findColumn(cols, SYNONYMS.amountPaid) ?? findColumnFuzzy(cols, AMOUNT_PAID_FUZZY)
    : findColumn(cols, SYNONYMS.amountPaid) ?? findColumn(cols, SYNONYMS.cumulativePaid) ?? findColumnFuzzy(cols, AMOUNT_PAID_FUZZY);
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
    const table = mergeNamedSheets(loadXlsbSheets(buffer)).table;
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
export function parseReconciliationRows(
  table: string[][],
  mapping: ReconciliationMapping,
  type: 'full' | 'partial',
  sheetTags?: string[]
): ParseResult<ReconciliationRow> {
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
    rows.push({ rowNumber, loanRef, phone, amount: amount ?? 0, name, amountOwed, bucketRaw: sheetTags?.[i] ?? null });
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
  commentSummary: { label: string; count: number }[];
  debtorReport: { name: string; phone: string; loanRef: string; balance: number; comment: string }[];
  agents: { name: string; calls: number; ptps: number; recovered: number }[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WellcashOps';
  workbook.created = new Date();

  // Matches a client-provided reference format exactly: two columns, one row per comment
  // (the debtor's current disposition) with its count, then a Total row whose value always
  // equals the Debtor Report sheet's row count — every debtor contributes exactly one
  // comment, "No calls yet" if they have none.
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Comments', key: 'label', width: 28 },
    { header: 'Count of comments', key: 'count', width: 18 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  input.commentSummary.forEach((row) => summarySheet.addRow(row));
  const total = input.commentSummary.reduce((s, r) => s + r.count, 0);
  summarySheet.addRow({ label: 'Total', count: total }).font = { bold: true };

  const debtorSheet = workbook.addWorksheet('Debtor Report');
  debtorSheet.columns = [
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Loan Ref', key: 'loanRef', width: 18 },
    { header: 'Balance', key: 'balance', width: 16 },
    { header: 'Comments', key: 'comment', width: 24 },
  ];
  debtorSheet.getRow(1).font = { bold: true };
  input.debtorReport.forEach((row) => debtorSheet.addRow(row));

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

// Excel worksheet names can't contain [ ] : * ? / \ and cap out at 31 characters — and two
// agents can share a display name (or collide after truncation), which ExcelJS rejects
// outright as a duplicate. Sanitize once, then de-dupe by appending "(2)", "(3)", etc.
function uniqueSheetName(base: string, used: Set<string>): string {
  const safe = base.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = safe;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = safe.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export interface DistributionDebtorRow {
  loanId: string;
  msisdn: string;
  customerName: string;
  totalOut: number;
  current: number;
  paid: number;
}

// Column set and header casing mirror the client's own long-standing reference workbook
// (LOAN ID / MSISDN / CUSTOMERNAME / TOTAL OUT / CURRENT / PAID / COMPANY) so a sheet from
// this export drops into their existing workflow unchanged. COMPANY there is always the
// literal string "Wellcash" (the collection agency, not the client) on every row, not a
// per-debtor value, so it's applied as a constant rather than threaded through as data.
// Their reference also has a PASTDUE column (days past due) — deliberately left out since
// wellcashops has no per-debtor days-past-due field to source it from honestly.
export async function buildFileDistributionWorkbook(input: {
  agents: { agentName: string; debtors: DistributionDebtorRow[] }[];
  unassigned: DistributionDebtorRow[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WellcashOps';
  workbook.created = new Date();

  const usedNames = new Set<string>();
  const addSheet = (title: string, rows: DistributionDebtorRow[]) => {
    const sheet = workbook.addWorksheet(uniqueSheetName(title, usedNames));
    sheet.columns = [
      { header: 'LOAN ID', key: 'loanId', width: 14 },
      { header: 'MSISDN', key: 'msisdn', width: 16 },
      { header: 'CUSTOMERNAME', key: 'customerName', width: 30 },
      { header: 'TOTAL OUT', key: 'totalOut', width: 14 },
      { header: 'CURRENT', key: 'current', width: 14 },
      { header: 'PAID', key: 'paid', width: 14 },
      { header: 'COMPANY', key: 'company', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    rows.forEach((row) => sheet.addRow({ ...row, company: 'Wellcash' }));
    sheet.addRow({});
    sheet.addRow({ customerName: 'Total', current: rows.reduce((s, r) => s + r.current, 0) }).font = { bold: true };
  };

  const allDebtors = [...input.agents.flatMap((a) => a.debtors), ...input.unassigned];
  addSheet('FILE', allDebtors);
  for (const agent of input.agents) addSheet(agent.agentName, agent.debtors);
  if (input.unassigned.length > 0) addSheet('Unassigned', input.unassigned);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
