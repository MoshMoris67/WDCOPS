import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const rate = Number(body?.rate);

  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
    return NextResponse.json({ error: 'rate must be a fraction between 0 and 1, e.g. 0.07 for 7%' }, { status: 400 });
  }

  const updated = await prisma.commissionRate.update({ where: { id }, data: { rate } }).catch(() => null);
  if (!updated) return NextResponse.json({ error: 'Commission rate not found' }, { status: 404 });

  return NextResponse.json({ rate: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  await prisma.commissionRate.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
