import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { code } = await params;
  const body = await req.json().catch(() => null);

  const data: { label?: string; description?: string | null; color?: string; requiresCallback?: boolean; requiresPtp?: boolean } = {};
  if (typeof body?.label === 'string' && body.label.trim()) data.label = body.label.trim();
  if (typeof body?.description === 'string' || body?.description === null) data.description = body?.description?.trim() || null;
  if (typeof body?.color === 'string') {
    if (!HEX_COLOR.test(body.color)) return NextResponse.json({ error: 'color must be a hex value like #16A34A' }, { status: 400 });
    data.color = body.color;
  }
  if (typeof body?.requiresCallback === 'boolean') data.requiresCallback = body.requiresCallback;
  if (typeof body?.requiresPtp === 'boolean') data.requiresPtp = body.requiresPtp;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const updated = await prisma.dispositionCode.update({ where: { code }, data }).catch(() => null);
  if (!updated) return NextResponse.json({ error: 'Disposition code not found' }, { status: 404 });

  return NextResponse.json({ code: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { code } = await params;

  const inUse = await prisma.callLog.count({ where: { dispositionCode: code } });
  if (inUse > 0) {
    return NextResponse.json({ error: `Can't delete — ${inUse} call log(s) already use this code` }, { status: 400 });
  }

  await prisma.dispositionCode.delete({ where: { code } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
