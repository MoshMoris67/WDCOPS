import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './db';
import { monthKey, isMonthKey, isQuarterKey, monthBounds, shiftMonth, quarterOf, monthsOfQuarter, shiftQuarter } from './performance-history-keys';

// Performance history: month-by-month results per agent per file, kept after the raw data
// (reconciliations, calls of cleared debtors) is gone. See PerformanceSnapshot in schema.prisma.
//
// Rules, as agreed with management:
//  - A payment counts in the month it was ACTUALLY PAID (ReconciliationEntry.paidDate, falling
//    back to when it was recorded for uploads that carry no payment date).
//  - It is credited to the agent who held the debtor ON THAT DAY (latest Assignment at or before
//    it; the debtor's current agent only when no assignment history exists).
//  - Quarters are calendar quarters (the fiscal year starts in January).

type Db = Pick<PrismaClient, '$queryRaw' | 'performanceSnapshot'>;

export interface PerfRow {
  clientId: string;
  clientName: string;
  fileId: string;
  batchLabel: string;
  agentId: string | null;
  agentName: string;
  accountsAssigned: number;
  bookAmount: number;
  accountsPaid: number;
  paymentCount: number;
  recovered: number;
  agentCommission: number;
  companyCommission: number;
  callsMade: number;
  promisesMade: number;
  promisedAmount: number;
}

export { monthKey, isMonthKey, isQuarterKey, monthBounds, shiftMonth, quarterOf, monthsOfQuarter, shiftQuarter };

// ---- Computing a month from live data ----

const rowKey = (fileId: string, agentId: string | null, agentName: string) =>
  `${fileId}|${agentId ?? `name:${agentName}`}`;

function emptyRow(base: Pick<PerfRow, 'clientId' | 'clientName' | 'fileId' | 'batchLabel' | 'agentId' | 'agentName'>): PerfRow {
  return {
    ...base,
    accountsAssigned: 0,
    bookAmount: 0,
    accountsPaid: 0,
    paymentCount: 0,
    recovered: 0,
    agentCommission: 0,
    companyCommission: 0,
    callsMade: 0,
    promisesMade: 0,
    promisedAmount: 0,
  };
}

/**
 * One business month's rows, computed from the data as it stands right now. Used for the
 * current month (shown live) and, just before a rollover deletes the data, to take the
 * snapshot. `accountsAssigned`/`bookAmount` describe the book as it stands at the moment of
 * computing (month end, for a capture at rollover).
 */
export async function computeMonthRows(db: Pick<PrismaClient, '$queryRaw'>, month: string, clientId?: string): Promise<PerfRow[]> {
  const { start, end } = monthBounds(month);
  const clientPay = clientId ? Prisma.sql`AND r."clientId" = ${clientId}` : Prisma.empty;
  const clientFile = clientId ? Prisma.sql`AND f."clientId" = ${clientId}` : Prisma.empty;

  const [payments, calls, books] = await Promise.all([
    db.$queryRaw<
      {
        clientId: string; clientName: string; fileId: string; batchLabel: string;
        agentId: string | null; agentName: string | null;
        paymentCount: number; accountsPaid: number; recovered: number; agentCommission: number; companyCommission: number;
      }[]
    >`
      SELECT s."clientId", s."clientName", s."fileId", s."batchLabel", s."agentId", s."agentName",
             COUNT(*)::int AS "paymentCount",
             COUNT(DISTINCT s."debtorId")::int AS "accountsPaid",
             COALESCE(SUM(s."paidAmount"), 0)::float AS "recovered",
             COALESCE(SUM(s."agentCommission"), 0)::float AS "agentCommission",
             COALESCE(SUM(s."companyCommission"), 0)::float AS "companyCommission"
      FROM (
        SELECT e."debtorId", e."paidAmount", e."agentCommission", e."companyCommission",
               f.id AS "fileId", f."batchLabel", f."clientId", c.name AS "clientName",
               CASE WHEN a.id IS NOT NULL THEN a."agentId" ELSE d."assignedAgentId" END AS "agentId",
               CASE WHEN a.id IS NOT NULL THEN COALESCE(ua.name, a."agentName") ELSE ud.name END AS "agentName"
        FROM "ReconciliationEntry" e
        JOIN "Reconciliation" r ON r.id = e."reconciliationId"
        JOIN "Debtor" d ON d.id = e."debtorId"
        JOIN "File" f ON f.id = d."fileId"
        JOIN "Client" c ON c.id = f."clientId"
        LEFT JOIN LATERAL (
          SELECT a2.id, a2."agentId", a2."agentName"
          FROM "Assignment" a2
          WHERE a2."debtorId" = e."debtorId" AND a2."assignedAt" <= COALESCE(e."paidDate", e."createdAt")
          ORDER BY a2."assignedAt" DESC
          LIMIT 1
        ) a ON true
        LEFT JOIN "User" ua ON ua.id = a."agentId"
        LEFT JOIN "User" ud ON ud.id = d."assignedAgentId"
        WHERE e."paidAmount" > 0
          AND COALESCE(e."paidDate", e."createdAt") >= ${start}
          AND COALESCE(e."paidDate", e."createdAt") < ${end}
          ${clientPay}
      ) s
      GROUP BY s."clientId", s."clientName", s."fileId", s."batchLabel", s."agentId", s."agentName"
    `,
    db.$queryRaw<
      {
        clientId: string; clientName: string; fileId: string; batchLabel: string;
        agentId: string | null; agentName: string;
        callsMade: number; promisesMade: number; promisedAmount: number;
      }[]
    >`
      SELECT f."clientId", c.name AS "clientName", f.id AS "fileId", f."batchLabel",
             cl."agentId", COALESCE(u.name, cl."agentName") AS "agentName",
             COUNT(*)::int AS "callsMade",
             COUNT(*) FILTER (WHERE cl."dispositionCode" = 'PTP')::int AS "promisesMade",
             COALESCE(SUM(cl."promisedAmount") FILTER (WHERE cl."dispositionCode" = 'PTP'), 0)::float AS "promisedAmount"
      FROM "CallLog" cl
      JOIN "Debtor" d ON d.id = cl."debtorId"
      JOIN "File" f ON f.id = d."fileId"
      JOIN "Client" c ON c.id = f."clientId"
      LEFT JOIN "User" u ON u.id = cl."agentId"
      WHERE cl."createdAt" >= ${start} AND cl."createdAt" < ${end}
        ${clientFile}
      GROUP BY f."clientId", c.name, f.id, f."batchLabel", cl."agentId", COALESCE(u.name, cl."agentName")
    `,
    db.$queryRaw<
      {
        clientId: string; clientName: string; fileId: string; batchLabel: string;
        agentId: string | null; agentName: string | null; accountsAssigned: number; bookAmount: number;
      }[]
    >`
      SELECT f."clientId", c.name AS "clientName", f.id AS "fileId", f."batchLabel",
             d."assignedAgentId" AS "agentId", u.name AS "agentName",
             COUNT(*)::int AS "accountsAssigned",
             COALESCE(SUM(d."amountOwed"), 0)::float AS "bookAmount"
      FROM "Debtor" d
      JOIN "File" f ON f.id = d."fileId"
      JOIN "Client" c ON c.id = f."clientId"
      LEFT JOIN "User" u ON u.id = d."assignedAgentId"
      WHERE TRUE ${clientFile}
      GROUP BY f."clientId", c.name, f.id, f."batchLabel", d."assignedAgentId", u.name
    `,
  ]);

  const rows = new Map<string, PerfRow>();
  const get = (r: { clientId: string; clientName: string; fileId: string; batchLabel: string; agentId: string | null; agentName: string | null }) => {
    const agentName = r.agentName ?? 'Unassigned';
    const key = rowKey(r.fileId, r.agentId, agentName);
    let row = rows.get(key);
    if (!row) {
      row = emptyRow({ clientId: r.clientId, clientName: r.clientName, fileId: r.fileId, batchLabel: r.batchLabel, agentId: r.agentId, agentName });
      rows.set(key, row);
    }
    return row;
  };

  for (const p of payments) {
    const row = get(p);
    row.paymentCount += p.paymentCount;
    row.accountsPaid += p.accountsPaid;
    row.recovered += p.recovered;
    row.agentCommission += p.agentCommission;
    row.companyCommission += p.companyCommission;
  }
  for (const c of calls) {
    const row = get(c);
    row.callsMade += c.callsMade;
    row.promisesMade += c.promisesMade;
    row.promisedAmount += c.promisedAmount;
  }
  for (const b of books) {
    const row = get(b);
    row.accountsAssigned += b.accountsAssigned;
    row.bookAmount += b.bookAmount;
  }
  return [...rows.values()];
}

// ---- Capturing at rollover ----

/**
 * Saves the snapshot for every month that the rollover is about to wipe, for one client.
 * Must run BEFORE the reconciliations/debtors are deleted (runNewMonth calls it first, inside
 * its transaction — if this throws, nothing is cleared). Write-once per client+month: a month
 * that already has rows is left alone, because part of its raw data (a cleared debtor's calls)
 * may be gone by now and recomputing would shrink it.
 */
export async function captureBeforeRollover(tx: Db, clientId: string, cutoff: Date): Promise<string[]> {
  const found = await tx.$queryRaw<{ at: Date }[]>`
    SELECT DISTINCT date_trunc('day', COALESCE(e."paidDate", e."createdAt")) AS at
    FROM "ReconciliationEntry" e
    JOIN "Reconciliation" r ON r.id = e."reconciliationId"
    WHERE r."clientId" = ${clientId} AND r."receivedAt" < ${cutoff}
  `;
  const cutoffMonth = monthKey(cutoff);
  const months = [...new Set(found.map((f) => monthKey(f.at)))].filter((m) => m < cutoffMonth).sort();
  const captured: string[] = [];

  for (const month of months) {
    const existing = await tx.performanceSnapshot.count({ where: { clientId, month } });
    if (existing > 0) continue;
    const rows = await computeMonthRows(tx, month, clientId);
    if (rows.length === 0) continue;
    await tx.performanceSnapshot.createMany({ data: rows.map((r) => ({ ...r, month })) });
    captured.push(month);
  }
  return captured;
}

// ---- Reading ----

export interface PerfTotals {
  recovered: number;
  bookAmount: number;
  recoveryRate: number | null; // recovered / bookAmount, null when no book
  accountsAssigned: number;
  accountsPaid: number;
  paymentCount: number;
  callsMade: number;
  promisesMade: number;
  promisedAmount: number;
  agentCommission: number;
  companyCommission: number;
}

function sum(rows: PerfRow[]): PerfTotals {
  const t: PerfTotals = {
    recovered: 0, bookAmount: 0, recoveryRate: null, accountsAssigned: 0, accountsPaid: 0,
    paymentCount: 0, callsMade: 0, promisesMade: 0, promisedAmount: 0, agentCommission: 0, companyCommission: 0,
  };
  for (const r of rows) {
    t.recovered += r.recovered;
    t.bookAmount += r.bookAmount;
    t.accountsAssigned += r.accountsAssigned;
    t.accountsPaid += r.accountsPaid;
    t.paymentCount += r.paymentCount;
    t.callsMade += r.callsMade;
    t.promisesMade += r.promisesMade;
    t.promisedAmount += r.promisedAmount;
    t.agentCommission += r.agentCommission;
    t.companyCommission += r.companyCommission;
  }
  t.recoveryRate = t.bookAmount > 0 ? t.recovered / t.bookAmount : null;
  return t;
}

export interface PerfBreakdownRow extends PerfTotals {
  id: string;
  name: string;
  subtitle?: string;
}

function breakdown(rows: PerfRow[], keyOf: (r: PerfRow) => { id: string; name: string; subtitle?: string }): PerfBreakdownRow[] {
  const groups = new Map<string, { meta: { id: string; name: string; subtitle?: string }; rows: PerfRow[] }>();
  for (const r of rows) {
    const meta = keyOf(r);
    const g = groups.get(meta.id) ?? { meta, rows: [] };
    g.rows.push(r);
    groups.set(meta.id, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g.meta, ...sum(g.rows) }))
    .sort((a, b) => b.recovered - a.recovered);
}

export interface PerformanceReport {
  period: string; // "2026-09" or "2026-Q3"
  kind: 'month' | 'quarter';
  /** Months in the period that are still live (not yet rolled over) — figures will still move. */
  liveMonths: string[];
  /** Months in the period with no data at all. */
  emptyMonths: string[];
  totals: PerfTotals;
  previousPeriod: string;
  previousTotals: PerfTotals;
  trend: { month: string; recovered: number; recoveryRate: number | null; live: boolean }[];
  months: { month: string; recovered: number; recoveryRate: number | null; live: boolean }[];
  files: PerfBreakdownRow[];
  agents: PerfBreakdownRow[];
}

/** All rows for a set of months: saved snapshots, plus live data for the current month. */
async function rowsForMonths(months: string[], clientId?: string, fileId?: string): Promise<{ byMonth: Map<string, PerfRow[]>; live: Set<string> }> {
  const byMonth = new Map<string, PerfRow[]>(months.map((m) => [m, []]));
  const live = new Set<string>();
  const current = monthKey(new Date());

  const saved = await prisma.performanceSnapshot.findMany({
    where: { month: { in: months }, ...(clientId ? { clientId } : {}), ...(fileId ? { fileId } : {}) },
  });
  const savedMonths = new Set<string>();
  for (const s of saved) {
    byMonth.get(s.month)?.push(s);
    savedMonths.add(s.month);
  }

  if (months.includes(current) && !savedMonths.has(current)) {
    const rows = await computeMonthRows(prisma, current, clientId);
    byMonth.set(current, fileId ? rows.filter((r) => r.fileId === fileId) : rows);
    live.add(current);
  }
  return { byMonth, live };
}

const agentKeyOf = (r: PerfRow) => r.agentId ?? `name:${r.agentName}`;

interface Window {
  kind: 'month' | 'quarter';
  period: string;
  periodMonths: string[];
  previousPeriod: string;
  previousMonths: string[];
  trendMonths: string[];
  byMonth: Map<string, PerfRow[]>;
  live: Set<string>;
}

async function loadWindow(period: string, scope: { clientId?: string; fileId?: string }): Promise<Window | null> {
  const kind = isQuarterKey(period) ? 'quarter' : isMonthKey(period) ? 'month' : null;
  if (!kind) return null;
  const periodMonths = kind === 'quarter' ? monthsOfQuarter(period) : [period];
  const previousPeriod = kind === 'quarter' ? shiftQuarter(period, -1) : shiftMonth(period, -1);
  const previousMonths = kind === 'quarter' ? monthsOfQuarter(previousPeriod) : [previousPeriod];
  const trendMonths = Array.from({ length: 12 }, (_, i) => shiftMonth(monthKey(new Date()), i - 11));
  const wanted = [...new Set([...periodMonths, ...previousMonths, ...trendMonths])];
  const { byMonth, live } = await rowsForMonths(wanted, scope.clientId, scope.fileId);
  return { kind, period, periodMonths, previousPeriod, previousMonths, trendMonths, byMonth, live };
}

// Flows (recovered, calls, ...) add up across months; the book (accounts held, amount owed)
// is a point-in-time figure, so across a quarter it is the OPENING one (the first month the
// agent/file pair appears in), not a sum — summing would triple the book, and a later month's
// book is smaller because each rollover rebases what is owed to what is still outstanding.
function mergeMonths(byMonth: Map<string, PerfRow[]>, months: string[], keep: (r: PerfRow) => boolean = () => true): PerfRow[] {
  const merged = new Map<string, PerfRow>();
  for (const m of [...months].sort()) {
    for (const r of byMonth.get(m) ?? []) {
      if (!keep(r)) continue;
      const key = rowKey(r.fileId, r.agentId, r.agentName);
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, { ...r });
        continue;
      }
      prev.paymentCount += r.paymentCount;
      prev.accountsPaid += r.accountsPaid;
      prev.recovered += r.recovered;
      prev.agentCommission += r.agentCommission;
      prev.companyCommission += r.companyCommission;
      prev.callsMade += r.callsMade;
      prev.promisesMade += r.promisesMade;
      prev.promisedAmount += r.promisedAmount;
    }
  }
  return [...merged.values()];
}

export async function buildPerformanceReport(period: string, scope: { clientId?: string; fileId?: string }): Promise<PerformanceReport | null> {
  const w = await loadWindow(period, scope);
  if (!w) return null;
  const { byMonth, live, periodMonths } = w;
  const periodRows = mergeMonths(byMonth, periodMonths);
  const monthSummary = (m: string) => {
    const t = sum(byMonth.get(m) ?? []);
    return { month: m, recovered: t.recovered, recoveryRate: t.recoveryRate, live: live.has(m) };
  };

  return {
    period,
    kind: w.kind,
    liveMonths: periodMonths.filter((m) => live.has(m)),
    emptyMonths: periodMonths.filter((m) => (byMonth.get(m) ?? []).length === 0),
    totals: sum(periodRows),
    previousPeriod: w.previousPeriod,
    previousTotals: sum(mergeMonths(byMonth, w.previousMonths)),
    trend: w.trendMonths.map(monthSummary),
    months: periodMonths.map(monthSummary),
    files: breakdown(periodRows, (r) => ({ id: r.fileId, name: r.batchLabel, subtitle: r.clientName })),
    agents: breakdown(periodRows, (r) => ({ id: agentKeyOf(r), name: r.agentName })),
  };
}

// ---- One agent ----

export interface AgentPoint {
  month: string;
  live: boolean;
  recovered: number;
  recoveryRate: number | null;
  callsMade: number;
  promisesMade: number;
  /** Rank among all agents that month by amount recovered (null if the agent had no activity). */
  rank: number | null;
  teamSize: number;
}

export interface AgentReport {
  period: string;
  kind: 'month' | 'quarter';
  agentId: string;
  agentName: string;
  liveMonths: string[];
  totals: PerfTotals;
  previousPeriod: string;
  previousTotals: PerfTotals;
  /** Rank in the period among all agents in scope, by amount recovered and by recovery rate. */
  rankByRecovered: number | null;
  rankByRate: number | null;
  teamSize: number;
  teamAverageRate: number | null;
  trend: AgentPoint[];
  /** The agent's files, best recovery rate first — strongest at the top, weakest at the bottom. */
  files: PerfBreakdownRow[];
}

function rankOf(rows: PerfBreakdownRow[], id: string, by: (r: PerfBreakdownRow) => number | null): number | null {
  const mine = rows.find((r) => r.id === id);
  if (!mine || by(mine) === null) return null;
  return 1 + rows.filter((r) => (by(r) ?? -1) > (by(mine) ?? -1)).length;
}

function agentPoint(w: Window, month: string, agentId: string): AgentPoint {
  const rows = w.byMonth.get(month) ?? [];
  const agents = breakdown(rows, (r) => ({ id: agentKeyOf(r), name: r.agentName }));
  const mine = agents.find((a) => a.id === agentId);
  const active = !!mine && (mine.recovered > 0 || mine.callsMade > 0);
  return {
    month,
    live: w.live.has(month),
    recovered: mine?.recovered ?? 0,
    recoveryRate: mine?.recoveryRate ?? null,
    callsMade: mine?.callsMade ?? 0,
    promisesMade: mine?.promisesMade ?? 0,
    rank: active ? rankOf(agents, agentId, (r) => r.recovered) : null,
    teamSize: agents.length,
  };
}

export async function buildAgentReport(period: string, agentId: string, scope: { clientId?: string; fileId?: string }): Promise<AgentReport | null> {
  const w = await loadWindow(period, scope);
  if (!w) return null;
  const periodRows = mergeMonths(w.byMonth, w.periodMonths);
  const team = breakdown(periodRows, (r) => ({ id: agentKeyOf(r), name: r.agentName }));
  const mineRows = periodRows.filter((r) => agentKeyOf(r) === agentId);
  const anyRow = mineRows[0] ?? [...w.byMonth.values()].flat().find((r) => agentKeyOf(r) === agentId);
  if (!anyRow) return null;
  const withRate = team.filter((a) => a.recoveryRate !== null);
  const teamTotals = sum(periodRows);

  return {
    period,
    kind: w.kind,
    agentId,
    agentName: anyRow.agentName,
    liveMonths: w.periodMonths.filter((m) => w.live.has(m)),
    totals: sum(mineRows),
    previousPeriod: w.previousPeriod,
    previousTotals: sum(mergeMonths(w.byMonth, w.previousMonths, (r) => agentKeyOf(r) === agentId)),
    rankByRecovered: rankOf(team, agentId, (r) => r.recovered),
    rankByRate: rankOf(withRate, agentId, (r) => r.recoveryRate),
    teamSize: team.length,
    teamAverageRate: teamTotals.recoveryRate,
    trend: w.trendMonths.map((m) => agentPoint(w, m, agentId)),
    files: breakdown(mineRows, (r) => ({ id: r.fileId, name: r.batchLabel, subtitle: r.clientName })).sort(
      (a, b) => (b.recoveryRate ?? -1) - (a.recoveryRate ?? -1)
    ),
  };
}

// ---- Two agents head to head ----

export interface CompareFileRow {
  fileId: string;
  name: string;
  subtitle: string;
  a: PerfTotals | null;
  b: PerfTotals | null;
}

export interface CompareReport {
  period: string;
  kind: 'month' | 'quarter';
  liveMonths: string[];
  a: { id: string; name: string; totals: PerfTotals };
  b: { id: string; name: string; totals: PerfTotals };
  /** Per month in the period — the two agents' recovery side by side. */
  months: { month: string; live: boolean; a: AgentPoint; b: AgentPoint }[];
  /** Every file either agent worked; `a`/`b` is null where that agent had no part in it. */
  files: CompareFileRow[];
  /** Plain-language cautions so the comparison is not misread (different book sizes, no shared file...). */
  notes: string[];
}

export async function buildCompareReport(period: string, agentA: string, agentB: string, scope: { clientId?: string; fileId?: string }): Promise<CompareReport | null> {
  const w = await loadWindow(period, scope);
  if (!w || agentA === agentB) return null;
  const periodRows = mergeMonths(w.byMonth, w.periodMonths);
  const rowsA = periodRows.filter((r) => agentKeyOf(r) === agentA);
  const rowsB = periodRows.filter((r) => agentKeyOf(r) === agentB);
  const everyRow = [...w.byMonth.values()].flat();
  const nameA = rowsA[0]?.agentName ?? everyRow.find((r) => agentKeyOf(r) === agentA)?.agentName;
  const nameB = rowsB[0]?.agentName ?? everyRow.find((r) => agentKeyOf(r) === agentB)?.agentName;
  if (!nameA || !nameB) return null;

  const totalsA = sum(rowsA);
  const totalsB = sum(rowsB);
  const byFile = new Map<string, CompareFileRow>();
  const addSide = (rows: PerfRow[], side: 'a' | 'b') => {
    const perFile = new Map<string, PerfRow[]>();
    for (const r of rows) perFile.set(r.fileId, [...(perFile.get(r.fileId) ?? []), r]);
    for (const [fileId, fileRows] of perFile) {
      const first = fileRows[0];
      const row = byFile.get(fileId) ?? { fileId, name: first.batchLabel, subtitle: first.clientName, a: null, b: null };
      row[side] = sum(fileRows);
      byFile.set(fileId, row);
    }
  };
  addSide(rowsA, 'a');
  addSide(rowsB, 'b');
  const files = [...byFile.values()].sort((x, y) => Number(!!(y.a && y.b)) - Number(!!(x.a && x.b)) || (y.a?.recovered ?? 0) + (y.b?.recovered ?? 0) - ((x.a?.recovered ?? 0) + (x.b?.recovered ?? 0)));
  const shared = files.filter((f) => f.a && f.b).length;

  const notes: string[] = [];
  const small = Math.min(totalsA.bookAmount, totalsB.bookAmount);
  const big = Math.max(totalsA.bookAmount, totalsB.bookAmount);
  if (small > 0 && big / small >= 1.5) {
    const bigger = totalsA.bookAmount > totalsB.bookAmount ? nameA : nameB;
    notes.push(`${bigger} held a book ${Math.round((big / small - 1) * 100)}% larger — compare recovery rate rather than amount recovered.`);
  }
  if (!scope.fileId && files.length > 0 && shared === 0) {
    notes.push('These two agents did not work any of the same files in this period, so the comparison is not like-for-like.');
  } else if (!scope.fileId && shared > 0 && shared < files.length) {
    notes.push(`Only ${shared} of ${files.length} files were worked by both agents — filter to one file for a like-for-like comparison.`);
  }
  if (w.periodMonths.some((m) => w.live.has(m))) notes.push('Includes a month still in progress — figures are live.');

  return {
    period,
    kind: w.kind,
    liveMonths: w.periodMonths.filter((m) => w.live.has(m)),
    a: { id: agentA, name: nameA, totals: totalsA },
    b: { id: agentB, name: nameB, totals: totalsB },
    months: w.periodMonths.map((m) => ({ month: m, live: w.live.has(m), a: agentPoint(w, m, agentA), b: agentPoint(w, m, agentB) })),
    files,
    notes,
  };
}
