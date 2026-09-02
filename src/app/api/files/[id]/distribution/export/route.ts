import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { buildFileDistributionWorkbook, type DistributionDebtorRow } from '@/lib/excel';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;

  const file = await prisma.file.findUnique({ where: { id }, select: { batchLabel: true, client: { select: { name: true } } } });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const debtors = await prisma.debtor.findMany({
    where: { fileId: id },
    select: {
      name: true,
      phone1: true,
      loanRef: true,
      amountOwed: true,
      balance: true,
      cumulativePaid: true,
      assignedAgentId: true,
      assignedAgent: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });

  const byAgent = new Map<string, { agentName: string; debtors: DistributionDebtorRow[] }>();
  const unassigned: DistributionDebtorRow[] = [];

  for (const d of debtors) {
    const row: DistributionDebtorRow = {
      loanId: d.loanRef,
      msisdn: d.phone1,
      customerName: d.name,
      totalOut: d.amountOwed,
      current: d.balance,
      paid: d.cumulativePaid,
    };
    if (!d.assignedAgentId) {
      unassigned.push(row);
      continue;
    }
    if (!byAgent.has(d.assignedAgentId)) {
      byAgent.set(d.assignedAgentId, { agentName: d.assignedAgent?.name ?? 'Unknown', debtors: [] });
    }
    byAgent.get(d.assignedAgentId)!.debtors.push(row);
  }

  const agents = [...byAgent.values()].sort((a, b) => a.agentName.localeCompare(b.agentName));

  const buffer = await buildFileDistributionWorkbook({ agents, unassigned });

  const filename = `${file.client.name}-${file.batchLabel}-distribution.xlsx`.replace(/["\r\n]/g, '');
  return new NextResponse(new Blob([new Uint8Array(buffer)]), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
