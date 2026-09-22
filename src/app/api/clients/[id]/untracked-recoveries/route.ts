import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { findUntrackedRecoveries, repairUntrackedRecoveries } from '@/lib/untracked-recoveries';

/** Preview: recovered money on this client's debtors that no reconciliation entry
 *  accounts for (see lib/untracked-recoveries.ts), broken down per file. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const files = await findUntrackedRecoveries(id);
  return NextResponse.json({ files });
}

/** Clears it — resets each affected debtor to what its reconciliation entries record. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const { debtorCount } = await repairUntrackedRecoveries(id);
  return NextResponse.json({ ok: true, debtorCount });
}
