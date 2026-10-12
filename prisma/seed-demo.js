/*
 * Demo database seed.
 *
 *   !!  THIS WIPES THE WHOLE TARGET DATABASE  !!
 *
 * It empties every table (except Prisma's migration history) and fills the database with
 * entirely fictional data for the neutral WellcashOps demo: demo.wellcash.com accounts,
 * made-up clients, debtors, call logs and reconciliations with amounts in USD.
 *
 * It is deliberately hard to run by accident, so it can never be pointed at the real
 * (Uganda) system:
 *   1. DEMO_SEED_CONFIRM must equal "wipe-demo-database".
 *   2. The DATABASE_URL host must end with one of DEMO_DB_HOST_SUFFIXES (default "neon.tech").
 *      The office server's own Postgres (localhost / a private address) is refused.
 *
 * Usage (from a machine that can reach the demo database):
 *   DATABASE_URL='postgresql://...neon.tech/...' DEMO_SEED_CONFIRM=wipe-demo-database \
 *     node prisma/seed-demo.js
 *
 * Every account's password is its own email address (e.g. admin@demo.wellcash.com).
 * Records get branch "demo", and the database's default branch is switched to "demo" so
 * anything created later in the demo also reads "demo" rather than "uganda".
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------------------
// Safety checks
// ---------------------------------------------------------------------------------------
function abort(message) {
  console.error('\nREFUSING TO RUN: ' + message + '\n');
  process.exit(1);
}

function checkSafety() {
  if (process.env.DEMO_SEED_CONFIRM !== 'wipe-demo-database') {
    abort('set DEMO_SEED_CONFIRM=wipe-demo-database to confirm you mean to erase the target database.');
  }
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL || '').hostname.toLowerCase();
  } catch {
    abort('DATABASE_URL is missing or not a valid URL.');
  }
  const suffixes = (process.env.DEMO_DB_HOST_SUFFIXES || 'neon.tech')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowed = suffixes.some((s) => host === s || host.endsWith('.' + s));
  if (!allowed) {
    abort(`database host "${host}" is not on the demo allow-list (${suffixes.join(', ')}).`);
  }
  return host;
}

// ---------------------------------------------------------------------------------------
// Deterministic random numbers, so a re-seed produces the same demo every time
// ---------------------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261012);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [value, w] of pairs) {
    if ((r -= w) <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}
const round2 = (n) => Math.round(n * 100) / 100;
const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const daysAgo = (d, jitterHours = 0) => new Date(now.getTime() - d * DAY - rnd() * jitterHours * 3600 * 1000);

async function createInChunks(model, rows, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    await prisma[model].createMany({ data: rows.slice(i, i + size) });
  }
}

// ---------------------------------------------------------------------------------------
// Fictional reference data — a deliberately neutral mix of names
// ---------------------------------------------------------------------------------------
const DISPOSITION_CODES = [
  { code: 'CB', label: 'Call Back', description: 'Debtor asked to be called at another time', color: '#1D4ED8', requiresCallback: true, requiresPtp: false },
  { code: 'DB', label: 'Disputing Balance', description: 'Debtor disputes the amount owed', color: '#DC2626', requiresCallback: false, requiresPtp: false },
  { code: 'DL', label: 'Disputing Loan', description: 'Debtor denies taking the loan', color: '#B91C1C', requiresCallback: false, requiresPtp: false },
  { code: 'HU', label: 'Hang Up', description: 'Debtor hung up mid-call without a clear response', color: '#EA580C', requiresCallback: false, requiresPtp: false },
  { code: 'NP', label: 'Negotiation In Progress', description: 'No dispute, but no payment commitment yet', color: '#D97706', requiresCallback: false, requiresPtp: false },
  { code: 'NA', label: 'No Answer', description: 'Call not answered', color: '#94A3B8', requiresCallback: false, requiresPtp: false },
  { code: 'NB', label: 'Number Busy', description: 'Line busy at time of call', color: '#7C3AED', requiresCallback: false, requiresPtp: false },
  { code: 'PTP', label: 'Promise To Pay', description: 'Debtor commits to pay — captures promised amount and date', color: '#16A34A', requiresCallback: false, requiresPtp: true },
  { code: 'SO', label: 'Switched Off', description: 'Number off at time of call', color: '#64748B', requiresCallback: false, requiresPtp: false },
  { code: 'OS', label: 'Out Of Service', description: 'Number is out of service', color: '#9333EA', requiresCallback: false, requiresPtp: false },
  { code: 'NE', label: "Number Doesn't Exist", description: "Number doesn't exist", color: '#7E22CE', requiresCallback: false, requiresPtp: false },
  { code: 'OR', label: 'Out Of Reach', description: 'Debtor is out of reach', color: '#A21CAF', requiresCallback: false, requiresPtp: false },
];

const DOMAIN = 'demo.wellcash.com';
const ADMINS = [
  { name: 'Demo Admin', email: `admin@${DOMAIN}` },
  { name: 'Operations Manager', email: `manager@${DOMAIN}` },
];
const AGENTS = [
  { name: 'Tendai Moyo', email: `tendai.moyo@${DOMAIN}` },
  { name: 'Amina Hassan', email: `amina.hassan@${DOMAIN}` },
  { name: 'Carlos Mabunda', email: `carlos.mabunda@${DOMAIN}` },
  { name: 'Grace Mwansa', email: `grace.mwansa@${DOMAIN}` },
  { name: 'Juma Kimaro', email: `juma.kimaro@${DOMAIN}` },
  { name: 'Wanjiru Kamau', email: `wanjiru.kamau@${DOMAIN}` },
  { name: 'Fatima Al Mansoori', email: `fatima.almansoori@${DOMAIN}` },
  { name: 'Sipho Ncube', email: `sipho.ncube@${DOMAIN}` },
];

const FIRST_NAMES = [
  'Amina', 'Carlos', 'Tendai', 'Grace', 'Juma', 'Wanjiru', 'Fatima', 'Sipho', 'Ana', 'David',
  'Mary', 'Joao', 'Rudo', 'Hassan', 'Neema', 'Kevin', 'Chipo', 'Omar', 'Esther', 'Tatenda',
  'Zainab', 'Lucas', 'Faith', 'Peter', 'Nadia', 'Joseph', 'Maria', 'Samuel', 'Sarah', 'Ibrahim',
  'Linda', 'Moses', 'Rosa', 'Daniel', 'Tabitha', 'Ali', 'Beatrice', 'Felix', 'Mercy', 'Yusuf',
];
const LAST_NAMES = [
  'Hassan', 'Mabunda', 'Moyo', 'Mwansa', 'Kimaro', 'Kamau', 'Ncube', 'Machava', 'Banda', 'Otieno',
  'Mushi', 'Chirwa', 'Sithole', 'Mutasa', 'Nkosi', 'Mbeki', 'Ali', 'Said', 'Phiri', 'Mwangi',
  'Chikwanha', 'Cossa', 'Tembo', 'Lungu', 'Mohamed', 'Njoroge', 'Dube', 'Mondlane', 'Kasonde', 'Juma',
];

const CLIENTS = [
  { name: 'Northwind Microfinance', reconciliationType: 'full', reportingFrequency: 'daily', prefix: 'NWM', commission: false },
  { name: 'Savanna Bank', reconciliationType: 'partial', reportingFrequency: 'weekly', prefix: 'SVB', commission: true },
  { name: 'Lakeside Mobile Money', reconciliationType: 'full', reportingFrequency: 'daily', prefix: 'LMM', commission: false },
  { name: 'Horizon Credit', reconciliationType: 'partial', reportingFrequency: 'monthly', prefix: 'HZC', commission: false },
];
const COMMISSION_RATES = { B30: 0.04, B60: 0.06, B90: 0.08, B120: 0.1, WO: 0.15 };

const PRODUCTS = ['Salary Loan', 'Business Loan', 'Mobile Loan', 'Asset Finance', 'Overdraft'];
const NOTES = {
  NA: ['Rang three times, no answer', 'Phone rang out', 'Voicemail, no message left'],
  NB: ['Line busy, retry later', 'Engaged tone'],
  SO: ['Phone switched off', 'Switched off since morning'],
  HU: ['Hung up when balance mentioned', 'Hung up after greeting'],
  NP: ['Discussing a repayment plan', 'Wants a reduced settlement, considering', 'Asked for a statement first'],
  CB: ['Driving, asked for a call back', 'In a meeting, call after lunch', 'Asked to call tomorrow morning'],
  PTP: ['Promised to pay after salary', 'Will pay part this week', 'Confirmed payment by transfer'],
  DB: ['Says the balance is too high', 'Disputes late fees'],
  DL: ['Says they never took this loan'],
  OS: ['Number out of service'],
  NE: ['Number does not exist'],
  OR: ['Relative says debtor travelling'],
};
const DISPOSITION_WEIGHTS = [
  ['NA', 25], ['NB', 8], ['SO', 8], ['HU', 6], ['NP', 16], ['CB', 10],
  ['PTP', 14], ['DB', 4], ['DL', 2], ['OS', 3], ['NE', 2], ['OR', 2],
];

// ---------------------------------------------------------------------------------------
async function main() {
  const host = checkSafety();
  console.log(`Target database host: ${host}`);
  console.log('Wiping all tables…');

  // Empty every table except Prisma's own migration bookkeeping.
  const tables = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  );
  if (tables.length > 0) {
    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }

  // New records created later in the demo read branch "demo" (the schema default is "uganda").
  for (const table of ['Client', 'File', 'Debtor', 'Reconciliation', 'User']) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ALTER COLUMN "branch" SET DEFAULT 'demo'`);
  }

  // Disposition codes
  await prisma.dispositionCode.createMany({ data: DISPOSITION_CODES });

  // Users — the password is the email address itself
  console.log('Creating users…');
  const users = [];
  for (const [i, a] of ADMINS.entries()) users.push({ id: `demo-admin-${i + 1}`, role: 'admin', ...a });
  for (const [i, a] of AGENTS.entries()) users.push({ id: `demo-agent-${i + 1}`, role: 'agent', ...a });
  for (const u of users) {
    u.passwordHash = await bcrypt.hash(u.email, 10);
  }
  await prisma.user.createMany({
    data: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      passwordHash: u.passwordHash,
      role: u.role,
      status: 'active',
      branch: 'demo',
    })),
  });
  const agents = users.filter((u) => u.role === 'agent');

  // Clients, commission rates, files
  console.log('Creating clients and files…');
  const clientRows = CLIENTS.map((c, i) => ({
    id: `demo-client-${i + 1}`,
    name: c.name,
    reconciliationType: c.reconciliationType,
    reportingFrequency: c.reportingFrequency,
    branch: 'demo',
  }));
  await prisma.client.createMany({ data: clientRows });
  const rates = [];
  CLIENTS.forEach((c, i) => {
    if (!c.commission) return;
    for (const [bucket, rate] of Object.entries(COMMISSION_RATES)) {
      rates.push({ id: `demo-rate-${i + 1}-${bucket}`, clientId: clientRows[i].id, bucket, rate });
    }
  });
  await prisma.commissionRate.createMany({ data: rates });

  const fileRows = [];
  CLIENTS.forEach((c, i) => {
    fileRows.push({
      id: `demo-file-${i + 1}`,
      clientId: clientRows[i].id,
      batchLabel: `${c.prefix}-Sep-2026-Batch1`,
      receivedDate: daysAgo(34),
      branch: 'demo',
      createdAt: daysAgo(34),
      updatedAt: daysAgo(34),
      importStatus: 'complete',
    });
  });
  // A mid-month top-up for the first client whose debtors are still waiting for distribution.
  fileRows.push({
    id: 'demo-file-topup',
    clientId: clientRows[0].id,
    batchLabel: `${CLIENTS[0].prefix}-Oct-2026-Topup`,
    receivedDate: daysAgo(3),
    isMidMonthTopup: true,
    branch: 'demo',
    createdAt: daysAgo(3),
    updatedAt: daysAgo(3),
    importStatus: 'complete',
  });
  await prisma.file.createMany({ data: fileRows });

  // Debtors
  console.log('Creating debtors…');
  const debtors = [];
  const assignments = [];
  const TOTAL = 640;
  for (let i = 1; i <= TOTAL; i++) {
    const topup = i > TOTAL - 40; // the last 40 sit in the top-up file, unassigned
    const file = topup ? fileRows[fileRows.length - 1] : fileRows[(i - 1) % CLIENTS.length];
    const owed = Math.round(120 + Math.pow(rnd(), 2.2) * 4800);
    const agent = topup ? null : agents[(i - 1) % agents.length];
    const days = intBetween(20, 160);
    debtors.push({
      id: `demo-debtor-${String(i).padStart(4, '0')}`,
      fileId: file.id,
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      phone1: `+000 7${intBetween(10, 99)} ${intBetween(100000, 999999)}`,
      phone2: rnd() < 0.4 ? `+000 7${intBetween(10, 99)} ${intBetween(100000, 999999)}` : null,
      loanRef: `LN-2026-${String(i).padStart(6, '0')}`,
      amountOwed: owed,
      cumulativePaid: 0,
      balance: owed,
      assignedAgentId: agent ? agent.id : null,
      branch: 'demo',
      extra: {
        'Days In Arrears': String(days),
        'Last Payment Date': daysAgo(days).toISOString().slice(0, 10),
        Product: pick(PRODUCTS),
      },
      createdAt: file.createdAt,
      updatedAt: file.createdAt,
      _clientIndex: topup ? 0 : (i - 1) % CLIENTS.length,
    });
    if (agent) {
      assignments.push({
        id: `demo-assign-${String(i).padStart(4, '0')}`,
        debtorId: `demo-debtor-${String(i).padStart(4, '0')}`,
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
        assignedAt: new Date(file.createdAt.getTime() + 3600 * 1000),
      });
    }
  }

  // Reconciliations: one processed batch per client, paying part of ~18% of its debtors
  console.log('Creating reconciliations and payments…');
  const reconRows = [];
  const entries = [];
  const byDebtorId = new Map(debtors.map((d) => [d.id, d]));
  CLIENTS.forEach((c, ci) => {
    const clientDebtors = debtors.filter((d) => d._clientIndex === ci);
    const paying = clientDebtors.filter(() => rnd() < 0.18);
    const receivedAt = daysAgo(6 - ci, 6);
    const recId = `demo-recon-${ci + 1}`;
    let total = 0;
    paying.forEach((d, k) => {
      const paid = round2(d.balance * between(0.15, 0.9));
      const bucket = c.commission ? pick(Object.keys(COMMISSION_RATES)) : null;
      const company = bucket ? round2(paid * COMMISSION_RATES[bucket]) : null;
      entries.push({
        id: `demo-entry-${ci + 1}-${k + 1}`,
        reconciliationId: recId,
        debtorId: d.id,
        oldBalance: d.balance,
        newBalance: round2(d.balance - paid),
        paidAmount: paid,
        createdAt: receivedAt,
        bucket,
        companyCommission: company,
        agentCommission: company !== null && d.assignedAgentId ? round2(company * 0.2) : null,
      });
      d.cumulativePaid = round2(d.cumulativePaid + paid);
      d.balance = round2(d.balance - paid);
      total += paid;
    });
    reconRows.push({
      id: recId,
      clientId: clientRows[ci].id,
      fileId: fileRows[ci].id,
      type: c.reconciliationType,
      receivedAt,
      processedAt: new Date(receivedAt.getTime() + 20 * 60 * 1000),
      recordCount: paying.length,
      updatedCount: paying.length,
      newAccountsCount: 0,
      unmatchedCount: 0,
      totalUpdated: round2(total),
      notes: 'Demo reconciliation',
      status: 'processed',
      branch: 'demo',
      createdAt: receivedAt,
    });
  });

  // Write debtors (without the helper field), assignments, reconciliations, entries
  await createInChunks(
    'debtor',
    debtors.map(({ _clientIndex, ...d }) => d)
  );
  await createInChunks('assignment', assignments);
  await prisma.reconciliation.createMany({ data: reconRows });
  await createInChunks('reconciliationEntry', entries);

  // Call logs: about three quarters of assigned debtors have been called one to four times
  console.log('Creating call logs…');
  const callLogs = [];
  let logN = 0;
  for (const d of debtors) {
    if (!d.assignedAgentId || rnd() > 0.75) continue;
    const calls = intBetween(1, 4);
    // newest call first, then walk backwards in time
    let when = daysAgo(rnd() < 0.15 ? 0 : between(0.2, 14), 4);
    for (let k = 0; k < calls; k++) {
      const code = k === 0 ? weighted(DISPOSITION_WEIGHTS) : weighted(DISPOSITION_WEIGHTS.filter(([c]) => c !== 'PTP' && c !== 'CB'));
      const log = {
        id: `demo-call-${String(++logN).padStart(5, '0')}`,
        debtorId: d.id,
        agentId: d.assignedAgentId,
        dispositionCode: code,
        note: pick(NOTES[code]),
        promisedAmount: null,
        promisedDate: null,
        createdAt: when,
      };
      if (code === 'PTP') {
        log.promisedAmount = round2(d.balance * between(0.3, 1));
        log.promisedDate = new Date(now.getTime() + between(-3, 10) * DAY);
      } else if (code === 'CB') {
        log.promisedDate = new Date(now.getTime() + between(-0.5, 3) * DAY);
      }
      callLogs.push(log);
      when = new Date(when.getTime() - between(1, 6) * DAY);
    }
  }
  await createInChunks('callLog', callLogs);

  console.log('\nDone. Demo database is ready:');
  console.log(`  users:           ${users.length} (${ADMINS.length} admins, ${agents.length} agents)`);
  console.log(`  clients:         ${clientRows.length}`);
  console.log(`  debtors:         ${debtors.length}`);
  console.log(`  call logs:       ${callLogs.length}`);
  console.log(`  payments:        ${entries.length}`);
  console.log('\nLog in as admin@demo.wellcash.com — the password is the same as the email.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
