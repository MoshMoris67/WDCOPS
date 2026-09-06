import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { computeDebtorStatus } from '@/lib/debtor-status';
import { getRecentCallLogsByDebtor, getRecentlyPaidDebtorIds } from '@/lib/debtor-aggregates';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const url = new URL(req.url);
  // Agents always see only their own assigned debtors. Admins see the whole branch by
  // default (Team Overview's "All Debtors" relies on this) — except when a caller
  // explicitly asks for their own queue via ?scope=mine, which an admin who also takes
  // calls needs (My Queue) just as much as a plain agent does.
  const mineOnly = url.searchParams.get('scope') === 'mine';
  const where: Prisma.DebtorWhereInput = session.role === 'agent' || mineOnly ? { assignedAgentId: session.sub } : {};

  // The unscoped admin path (Team Overview's All Debtors table) can be 85,000+ rows.
  // Explicitly paged agent-queue requests use the same bounded query; the no-page
  // scope=mine request remains available for dashboard offline warm-up.
  const search = url.searchParams.get('search')?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { loanRef: { contains: search } },
      { phone1: { contains: search } },
    ];
  }
  const clientId = url.searchParams.get('clientId');
  if (clientId) where.file = { clientId };
  const fileId = url.searchParams.get('fileId');
  if (fileId) where.fileId = fileId;
  const agentId = url.searchParams.get('agentId');
  if (agentId) where.assignedAgentId = agentId;

  // Lean, unpaginated id-only mode — backs "select all N matching this filter" for bulk
  // reassignment, which needs every matching id (potentially thousands), not a page of
  // full debtor objects. Cheap even at scale since it's a single indexed column, no joins.
  if (url.searchParams.get('idsOnly') === 'true') {
    const ids = await prisma.debtor.findMany({ where, select: { id: true } });
    return NextResponse.json({ ids: ids.map((d) => d.id) });
  }

  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const requestedPageSize = Number(url.searchParams.get('pageSize'));
  const sortField = url.searchParams.get('sort');
  const sortDir = url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  // An explicit pageSize is capped for both admin and agent views. Requests without a
  // pageSize retain the full agent queue response for the dashboard's offline snapshot.
  const pageSize = mineOnly
    ? (requestedPageSize > 0 ? Math.min(100, requestedPageSize) : undefined)
    : Math.min(100, requestedPageSize > 0 ? requestedPageSize : 25);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Fetching each debtor's status used to nest `callLogs: { take: 5 }` and
  // `reconciliationEntries: { take: 1 }` right in this query — fine at normal queue
  // sizes, but a genuinely expensive relation-per-row fetch once one agent's queue
  // reaches into the thousands (found via a real 10,000+-debtor queue timing out the
  // client's fetch). Fetch the flat debtor rows first, then both status inputs for the
  // whole batch in two DB-aggregated queries (debtor-aggregates.ts) instead of one
  // per debtor — same fix pattern already applied to the admin-side views.
  const orderBy = sortField === 'name' || sortField === 'loanRef' || sortField === 'balance' || sortField === 'createdAt'
    ? { [sortField]: sortDir }
    : { createdAt: 'asc' as const };

  const [total, debtors] = await Promise.all([
    prisma.debtor.count({ where }),
    prisma.debtor.findMany({
      where,
      include: { file: { include: { client: true } } },
      orderBy,
      ...(pageSize ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    }),
  ]);

  const debtorIds = debtors.map((d) => d.id);
  const [callLogsByDebtor, recentlyPaidIds] = await Promise.all([
    getRecentCallLogsByDebtor(debtorIds),
    getRecentlyPaidDebtorIds(debtorIds, sevenDaysAgo),
  ]);

  const result = debtors.map((d) => ({
    id: d.id,
    name: d.name,
    phone: d.phone1,
    loanRef: d.loanRef,
    amountOwed: d.amountOwed,
    balance: d.balance,
    client: d.file.client.name,
    recentlyPaid: recentlyPaidIds.has(d.id),
    ...computeDebtorStatus(callLogsByDebtor.get(d.id) ?? []),
  }));

  return NextResponse.json({ debtors: result, total, page, pageSize: pageSize ?? total });
}
