import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { planEvenOut, loadEvenOutDebtors, applyEvenOut } from '@/lib/even-out';

/**
 * Levels per-agent headcount across the agents who already hold debtors on this file — for
 * when something (typically the daily sync's coverage-weighted assignment) left it lopsided.
 * See lib/even-out.ts for which debtors may move.
 *
 * POST { apply: false } (default) only previews; { apply: true } writes the moves as one
 * ReassignmentBatch, so it appears in the file's redistribution history and can be undone.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const apply = body?.apply === true;

  const file = await prisma.file.findUnique({ where: { id }, select: { id: true } });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const plan = planEvenOut(await loadEvenOutDebtors(id));
  const users = await prisma.user.findMany({
    where: { id: { in: [...plan.before.keys()] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const agents = [...plan.before.keys()]
    .map((agentId) => ({
      agentId,
      agentName: nameById.get(agentId) ?? 'Unknown',
      before: plan.before.get(agentId)!,
      target: plan.targets.get(agentId)!,
      after: plan.after.get(agentId)!,
    }))
    .sort((a, b) => b.before - a.before);

  const summary = { agents, moveCount: plan.moves.length, shortfall: plan.shortfall };

  if (!apply) return NextResponse.json({ applied: false, ...summary });

  const batchId = await applyEvenOut(id, plan.moves);
  return NextResponse.json({ applied: true, batchId, ...summary });
}
