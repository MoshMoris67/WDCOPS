import ExcelJS from 'exceljs';
import { prisma } from './db';
import {
  buildPerformanceReport,
  buildAgentReport,
  buildCompareReport,
  type PerfTotals,
  type PerfBreakdownRow,
} from './performance-history';

// Excel export of the History page. Every workbook starts with a Summary sheet that states
// exactly which filters produced it ("Agent A vs Agent B, KCB, Q3 2026"), so a copy handed to
// management can't be mistaken for a different cut of the data.

export interface ExportRequest {
  view: 'overview' | 'agent' | 'compare';
  period: string;
  clientId?: string;
  fileId?: string;
  agentId?: string;
  agentA?: string;
  agentB?: string;
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const periodLabel = (p: string) => (p.includes('-Q') ? `Q${p.split('-Q')[1]} ${p.split('-Q')[0]}` : monthLabel(p));

const MONEY = '#,##0.00';
const PCT = '0.0%';

function bold(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

const METRIC_COLUMNS: { header: string; key: string; width: number; fmt?: string; get: (t: PerfTotals) => number | null }[] = [
  { header: 'Recovered', key: 'recovered', width: 16, fmt: MONEY, get: (t) => t.recovered },
  { header: 'Recovery rate', key: 'rate', width: 14, fmt: PCT, get: (t) => t.recoveryRate },
  { header: 'Accounts held', key: 'held', width: 14, get: (t) => t.accountsAssigned },
  { header: 'Book (amount owed)', key: 'book', width: 18, fmt: MONEY, get: (t) => t.bookAmount },
  { header: 'Accounts that paid', key: 'paid', width: 18, get: (t) => t.accountsPaid },
  { header: 'Payments', key: 'payments', width: 11, get: (t) => t.paymentCount },
  { header: 'Calls made', key: 'calls', width: 12, get: (t) => t.callsMade },
  { header: 'Promises to pay', key: 'ptp', width: 15, get: (t) => t.promisesMade },
  { header: 'Promised amount', key: 'ptpAmt', width: 16, fmt: MONEY, get: (t) => t.promisedAmount },
  { header: 'Agent commission', key: 'comm', width: 17, fmt: MONEY, get: (t) => t.agentCommission },
];

function metricCells(t: PerfTotals): Record<string, number | null> {
  return Object.fromEntries(METRIC_COLUMNS.map((c) => [c.key, c.get(t)]));
}

function breakdownSheet(wb: ExcelJS.Workbook, name: string, firstHeader: string, rows: PerfBreakdownRow[], withClient: boolean) {
  const sheet = wb.addWorksheet(name);
  sheet.columns = [
    { header: firstHeader, key: 'name', width: 34 },
    ...(withClient ? [{ header: 'Client', key: 'client', width: 22 }] : []),
    ...METRIC_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} })),
  ];
  for (const r of rows) sheet.addRow({ name: r.name, client: r.subtitle ?? '', ...metricCells(r) });
  bold(sheet);
  return sheet;
}

async function scopeLines(req: ExportRequest): Promise<[string, string][]> {
  const [client, file] = await Promise.all([
    req.clientId ? prisma.client.findUnique({ where: { id: req.clientId }, select: { name: true } }) : null,
    req.fileId ? prisma.file.findUnique({ where: { id: req.fileId }, select: { batchLabel: true } }) : null,
  ]);
  return [
    ['Period', periodLabel(req.period)],
    ['Client', client?.name ?? 'All clients'],
    ['File', file?.batchLabel ?? 'All files'],
  ];
}

function summarySheet(wb: ExcelJS.Workbook, title: string, lines: [string, string][], notes: string[]) {
  const sheet = wb.addWorksheet('Summary');
  sheet.columns = [{ width: 34 }, { width: 44 }];
  sheet.addRow([title]).font = { bold: true, size: 14 };
  sheet.addRow([]);
  for (const [k, v] of lines) {
    const row = sheet.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  }
  sheet.addRow(['Generated', new Date().toISOString()]).getCell(1).font = { bold: true };
  sheet.addRow([]);
  for (const n of [
    ...notes,
    'A payment counts in the month it was actually paid and is credited to the agent who held the account that day.',
    'Recovery rate = recovered ÷ amount owed on the accounts held. Across a quarter the book is the opening one.',
  ]) {
    sheet.addRow([n]).getCell(1).alignment = { wrapText: false };
  }
  return sheet;
}

export async function buildPerformanceWorkbook(req: ExportRequest): Promise<{ buffer: Buffer; filename: string } | { error: string; status: number }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WellcashOps';
  wb.created = new Date();
  const scope = { clientId: req.clientId, fileId: req.fileId };
  const base = await scopeLines(req);
  const liveNote = (months: string[]) => (months.length ? [`${months.map(monthLabel).join(', ')} is still in progress — these figures are live and will change.`] : []);
  let name: string;

  if (req.view === 'agent') {
    if (!req.agentId) return { error: 'agentId is required', status: 400 };
    const r = await buildAgentReport(req.period, req.agentId, scope);
    if (!r) return { error: 'No performance found for that agent and period', status: 404 };
    name = `${r.agentName}-${req.period}`;
    const sum = summarySheet(wb, `Agent performance — ${r.agentName}`, [['Agent', r.agentName], ...base], liveNote(r.liveMonths));
    sum.addRow([]);
    sum.addRow(['Rank by amount recovered', r.rankByRecovered ? `${r.rankByRecovered} of ${r.teamSize}` : '—']);
    sum.addRow(['Rank by recovery rate', r.rankByRate ? `${r.rankByRate} of ${r.teamSize}` : '—']);
    sum.addRow([]);
    sum.addRow(['Metric', periodLabel(r.period), periodLabel(r.previousPeriod)]).font = { bold: true };
    for (const c of METRIC_COLUMNS) {
      const row = sum.addRow([c.header, c.get(r.totals), c.get(r.previousTotals)]);
      if (c.fmt) row.eachCell((cell, n) => n > 1 && (cell.numFmt = c.fmt!));
    }
    const trend = wb.addWorksheet('Last 12 months');
    trend.columns = [
      { header: 'Month', key: 'month', width: 18 },
      { header: 'Recovered', key: 'rec', width: 16, style: { numFmt: MONEY } },
      { header: 'Recovery rate', key: 'rate', width: 14, style: { numFmt: PCT } },
      { header: 'Calls made', key: 'calls', width: 12 },
      { header: 'Promises to pay', key: 'ptp', width: 15 },
      { header: 'Rank in team', key: 'rank', width: 14 },
      { header: 'Agents active', key: 'team', width: 14 },
      { header: 'Status', key: 'live', width: 12 },
    ];
    for (const p of r.trend) trend.addRow({ month: monthLabel(p.month), rec: p.recovered, rate: p.recoveryRate, calls: p.callsMade, ptp: p.promisesMade, rank: p.rank, team: p.teamSize, live: p.live ? 'In progress' : '' });
    bold(trend);
    breakdownSheet(wb, 'Files', 'File', r.files, true);
  } else if (req.view === 'compare') {
    if (!req.agentA || !req.agentB) return { error: 'Pick two different agents', status: 400 };
    const r = await buildCompareReport(req.period, req.agentA, req.agentB, scope);
    if (!r) return { error: 'No performance found for those agents and period', status: 404 };
    name = `${r.a.name}-vs-${r.b.name}-${req.period}`;
    const sum = summarySheet(wb, `${r.a.name} vs ${r.b.name}`, [['Agents', `${r.a.name} vs ${r.b.name}`], ...base], [...r.notes]);
    sum.addRow([]);
    sum.addRow(['Metric', r.a.name, r.b.name, 'Difference']).font = { bold: true };
    for (const c of METRIC_COLUMNS) {
      const va = c.get(r.a.totals);
      const vb = c.get(r.b.totals);
      const row = sum.addRow([c.header, va, vb, va !== null && vb !== null ? va - vb : null]);
      if (c.fmt) row.eachCell((cell, n) => n > 1 && (cell.numFmt = c.fmt!));
    }
    const months = wb.addWorksheet('By month');
    months.columns = [
      { header: 'Month', key: 'm', width: 18 },
      { header: `${r.a.name} recovered`, key: 'ar', width: 22, style: { numFmt: MONEY } },
      { header: `${r.a.name} rate`, key: 'arate', width: 18, style: { numFmt: PCT } },
      { header: `${r.b.name} recovered`, key: 'br', width: 22, style: { numFmt: MONEY } },
      { header: `${r.b.name} rate`, key: 'brate', width: 18, style: { numFmt: PCT } },
    ];
    for (const m of r.months) months.addRow({ m: monthLabel(m.month) + (m.live ? ' (in progress)' : ''), ar: m.a.recovered, arate: m.a.recoveryRate, br: m.b.recovered, brate: m.b.recoveryRate });
    bold(months);
    const files = wb.addWorksheet('By file');
    files.columns = [
      { header: 'File', key: 'f', width: 34 },
      { header: 'Client', key: 'c', width: 22 },
      { header: 'Worked by', key: 'w', width: 16 },
      { header: `${r.a.name} recovered`, key: 'ar', width: 22, style: { numFmt: MONEY } },
      { header: `${r.a.name} rate`, key: 'arate', width: 18, style: { numFmt: PCT } },
      { header: `${r.b.name} recovered`, key: 'br', width: 22, style: { numFmt: MONEY } },
      { header: `${r.b.name} rate`, key: 'brate', width: 18, style: { numFmt: PCT } },
    ];
    for (const f of r.files) {
      files.addRow({ f: f.name, c: f.subtitle, w: f.a && f.b ? 'Both' : 'One agent', ar: f.a?.recovered ?? null, arate: f.a?.recoveryRate ?? null, br: f.b?.recovered ?? null, brate: f.b?.recoveryRate ?? null });
    }
    bold(files);
  } else {
    const r = await buildPerformanceReport(req.period, scope);
    if (!r) return { error: 'period must look like 2026-09 or 2026-Q3', status: 400 };
    name = `performance-${req.period}`;
    const sum = summarySheet(wb, 'Performance summary', base, liveNote(r.liveMonths));
    sum.addRow([]);
    sum.addRow(['Metric', periodLabel(r.period), periodLabel(r.previousPeriod)]).font = { bold: true };
    for (const c of METRIC_COLUMNS) {
      const row = sum.addRow([c.header, c.get(r.totals), c.get(r.previousTotals)]);
      if (c.fmt) row.eachCell((cell, n) => n > 1 && (cell.numFmt = c.fmt!));
    }
    breakdownSheet(wb, 'By file', 'File', r.files, true);
    breakdownSheet(wb, 'By agent', 'Agent', r.agents, false);
    const trend = wb.addWorksheet('Last 12 months');
    trend.columns = [
      { header: 'Month', key: 'm', width: 18 },
      { header: 'Recovered', key: 'rec', width: 16, style: { numFmt: MONEY } },
      { header: 'Recovery rate', key: 'rate', width: 14, style: { numFmt: PCT } },
      { header: 'Status', key: 'live', width: 14 },
    ];
    for (const p of r.trend) trend.addRow({ m: monthLabel(p.month), rec: p.recovered, rate: p.recoveryRate, live: p.live ? 'In progress' : '' });
    bold(trend);
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `${name}.xlsx` };
}
