const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DISPOSITION_CODES = [
  { code: 'CB', label: 'Call Back', description: 'Debtor asked to be called at another time', color: '#1D4ED8', requiresCallback: true, requiresPtp: false },
  { code: 'DB', label: 'Disputing Balance', description: 'Debtor disputes the amount owed', color: '#DC2626', requiresCallback: false, requiresPtp: false },
  { code: 'DL', label: 'Disputing Loan', description: 'Debtor denies taking the loan', color: '#B91C1C', requiresCallback: false, requiresPtp: false },
  { code: 'HU', label: 'Hang Up', description: 'Debtor hung up mid-call without a clear response', color: '#EA580C', requiresCallback: false, requiresPtp: false },
  { code: 'NP', label: 'Negotiation In Progress', description: 'No dispute, but no payment commitment yet', color: '#D97706', requiresCallback: false, requiresPtp: false },
  { code: 'NA', label: 'No Answer', description: 'Call not answered — counts toward the stale-account flag', color: '#94A3B8', requiresCallback: false, requiresPtp: false },
  { code: 'NB', label: 'Number Busy', description: 'Line busy at time of call', color: '#7C3AED', requiresCallback: false, requiresPtp: false },
  { code: 'PTP', label: 'Promise To Pay', description: 'Debtor commits to pay — captures promised amount and date', color: '#16A34A', requiresCallback: false, requiresPtp: true },
  { code: 'SO', label: 'Switched Off', description: 'Number off at time of call', color: '#64748B', requiresCallback: false, requiresPtp: false },
  { code: 'OS', label: 'Out Of Service', description: 'Number is out of service', color: '#9333EA', requiresCallback: false, requiresPtp: false },
  { code: 'NE', label: "Number Doesn't Exist", description: "Number doesn't exist", color: '#7E22CE', requiresCallback: false, requiresPtp: false },
  { code: 'OR', label: 'Out Of Reach', description: 'Debtor is out of reach', color: '#A21CAF', requiresCallback: false, requiresPtp: false },
];

async function main() {
  for (const d of DISPOSITION_CODES) {
    await prisma.dispositionCode.upsert({ where: { code: d.code }, update: d, create: d });
  }

  const admin = await upsertUser('admin@wellcash.ug', 'Admin@2026!', 'IT Admin', 'admin');
  const secondAdmin = await upsertUser('nakato@wellcash.ug', 'Admin@2026!', 'Nakato Sarah', 'admin');
  const agent = await upsertUser('agent.okonkwo@wellcash.ug', 'Agent@2026!', 'Amara Okonkwo', 'agent');
  const extAgent = await upsertUser('ext.wasswa@wellcash.ug', 'Ext@2026!', 'Wasswa Denis', 'agent');
  await upsertUser('agent.byaruhanga@wellcash.ug', 'Agent@2026!', 'Byaruhanga Moses', 'agent');
  await upsertUser('agent.achen@wellcash.ug', 'Agent@2026!', 'Achen Miriam', 'agent');
  await upsertUser('ext.nabirye@wellcash.ug', 'Ext@2026!', 'Nabirye Rose', 'agent');
  await upsertUser('ext.tumusiime@wellcash.ug', 'Ext@2026!', 'Tumusiime Grace', 'agent');

  // Deliberately no demo clients, files, or debtors here — those are real operational
  // data entered through the app (Settings → Clients, File Management → Import), not
  // something a seed script should ever recreate. Wiped from the dev database on
  // 2026-08-18 at the user's request; kept out of seed.js so a future `prisma migrate
  // reset` doesn't quietly bring them back.

  console.log('Seeded:', { admin: admin.email, secondAdmin: secondAdmin.email, agent: agent.email, extAgent: extAgent.email });
}

async function upsertUser(email, password, name, role) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { email },
    update: { passwordHash, name, role },
    create: { email, passwordHash, name, role },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
