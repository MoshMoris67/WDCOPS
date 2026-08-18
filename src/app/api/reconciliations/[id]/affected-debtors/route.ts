import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await params;
  const entries = await prisma.reconciliationEntry.findMany({
    where: { reconciliationId: id },
    include: { debtor: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    affectedDebtors: entries.map((e) => ({
      id: e.debtor.id,
      name: e.debtor.name,
      loanRef: e.debtor.loanRef,
      oldBalance: e.oldBalance,
      newBalance: e.newBalance,
      paid: e.paidAmount,
    })),
  });
}
