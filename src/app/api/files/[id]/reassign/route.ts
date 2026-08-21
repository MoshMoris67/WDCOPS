import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { reassignFile } from '@/lib/reassign';

/**
 * Redistributes an already-distributed file across a new agent roster — see
 * lib/reassign.ts for the algorithm. Requires the file to be recalled first: reassigning
 * ownership out from under an agent who might be actively working the file (auto-advance
 * queue open, mid-call) would silently move a debtor to someone else's queue while they're
 * looking at it. Recall already exists to stop agents from seeing a file's debtors in
 * their active queue — this reuses that same gate rather than inventing a new one.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const agentIds: string[] = Array.isArray(body?.agentIds) ? body.agentIds.filter((a: unknown) => typeof a === 'string') : [];
  if (agentIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one agent to reassign to' }, { status: 400 });
  }

  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  if (!file.isRecalled) {
    return NextResponse.json(
      { error: 'Recall this file first — reassigning while agents may still be actively working it risks moving a debtor out from under them mid-call.' },
      { status: 400 }
    );
  }

  const agents = await prisma.user.findMany({
    where: { status: 'active', role: { in: ['agent', 'admin'] }, id: { in: agentIds } },
    select: { id: true },
  });
  if (agents.length !== agentIds.length) {
    return NextResponse.json({ error: 'One or more selected agents are not active agents' }, { status: 400 });
  }

  const result = await reassignFile(id, agentIds);
  return NextResponse.json(result);
}
