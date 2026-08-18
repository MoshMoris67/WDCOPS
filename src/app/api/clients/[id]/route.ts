import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const data: { name?: string; reconciliationType?: string; reportingFrequency?: string } = {};
  if (typeof body?.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (typeof body?.reconciliationType === 'string') {
    if (!['full', 'partial'].includes(body.reconciliationType)) {
      return NextResponse.json({ error: 'reconciliationType must be full or partial' }, { status: 400 });
    }
    data.reconciliationType = body.reconciliationType;
  }
  if (typeof body?.reportingFrequency === 'string') {
    if (!['daily', 'weekly', 'monthly'].includes(body.reportingFrequency)) {
      return NextResponse.json({ error: 'reportingFrequency must be daily, weekly, or monthly' }, { status: 400 });
    }
    data.reportingFrequency = body.reportingFrequency;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  if (data.name) {
    const clash = await prisma.client.findFirst({ where: { name: data.name, NOT: { id } } });
    if (clash) return NextResponse.json({ error: 'A client with that name already exists' }, { status: 409 });
  }

  const updated = await prisma.client.update({ where: { id }, data }).catch(() => null);
  if (!updated) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  return NextResponse.json({ client: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;

  const fileCount = await prisma.file.count({ where: { clientId: id } });
  if (fileCount > 0) {
    return NextResponse.json(
      { error: `Can't delete — ${fileCount} file batch(es) still belong to this client. Remove those first.` },
      { status: 400 }
    );
  }

  await prisma.client.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
