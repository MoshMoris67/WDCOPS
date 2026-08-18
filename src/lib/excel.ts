import ExcelJS from 'exceljs';

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const SUPPORTED_IMPORT_EXTENSIONS = ['.xlsx', '.csv'];

function isCsv(filename: string): boolean {
  return filename.toLowerCase().endsWith('.csv');
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

function sheetToRows(sheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cellFromXlsxValue(cell.value));
    });
    rows.push(cells);
  });
  return rows;
}

function rowsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((cell, i) => cell.trim().toLowerCase() === (b[i] ?? '').trim().toLowerCase());
}

/**
 * Loads any supported file into a plain table (row 0 = header) — .xlsx via exceljs,
 * .csv via the fast tokenizer above. A workbook with multiple sheets (e.g. a client
 * splitting one large roster across tabs to work around a row limit in whatever
 * tool produced it) has every sheet's rows appended after the first, using the
 * first sheet's header as canonical — if a later sheet repeats that same header
 * row verbatim, it's dropped as a duplicate rather than imported as a debtor.
 */
export async function loadTable(buffer: ArrayBuffer, filename: string): Promise<string[][]> {
  if (isCsv(filename)) {
    return parseCsvText(Buffer.from(buffer).toString('utf8'));
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (workbook.worksheets.length === 0) throw new Error('The workbook has no sheets');

  const [firstSheet, ...restSheets] = workbook.worksheets;
  const rows = sheetToRows(firstSheet);
  const headerRow = rows[0];

  for (const sheet of restSheets) {
    const sheetRows = sheetToRows(sheet);
    if (sheetRows.length === 0) continue;
    const startsWithRepeatedHeader = headerRow && rowsMatch(sheetRows[0], headerRow);
    rows.push(...sheetRows.slice(startsWithRepeatedHeader ? 1 : 0));
  }

  return rows;
}

export interface SheetInfo {
  name: string;
  rowCount: number;
}

/** Sheet names + row counts for a workbook — surfaced in the import preview so an admin can see every sheet got picked up. */
export async function listSheets(buffer: ArrayBuffer, filename: string): Promise<SheetInfo[]> {
  if (isCsv(filename)) return [{ name: filename, rowCount: 0 }];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets.map((s) => ({ name: s.name, rowCount: s.rowCount }));
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
  totalRows: number;
  sheets: SheetInfo[];
}

/** Parses just enough of the file to show a mapping-confirmation step — headers, a few sample rows, and a best-guess mapping. */
export async function previewImportFile(buffer: ArrayBuffer, filename: string): Promise<FilePreview> {
  const [table, sheets] = await Promise.all([loadTable(buffer, filename), listSheets(buffer, filename)]);
  const headers = table[0] ?? [];
  return {
    headers,
    sampleRows: table.slice(1, 6),
    suggested: suggestImportMapping(headers),
    totalRows: Math.max(0, table.length - 1),
    sheets,
  };
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

/**
 * Reconciliation template: Loan Ref and/or Phone to match, plus Amount Paid (partial) or
 * Cumulative Paid (full). Optionally also Name + Amount Owed for rows that are actually new
 * accounts riding along with the reconciliation rather than a payment update. Accepts .xlsx or .csv.
 */
export async function parseReconciliationWorkbook(
  buffer: ArrayBuffer,
  type: 'full' | 'partial',
  filename: string
): Promise<ParseResult<ReconciliationRow>> {
  const table = await loadTable(buffer, filename);
  const cols = headerColumnMap(table[0] ?? []);

  const loanRefCol = cols.get('loanref') ?? cols.get('loanreference');
  const phoneCol = cols.get('phone') ?? cols.get('phone1') ?? cols.get('phonenumber');
  const amountCol = type === 'full'
    ? (cols.get('cumulativepaid') ?? cols.get('amountpaid'))
    : (cols.get('amountpaid') ?? cols.get('cumulativepaid'));
  const nameCol = cols.get('name');
  const amountOwedCol = cols.get('amountowed');

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
