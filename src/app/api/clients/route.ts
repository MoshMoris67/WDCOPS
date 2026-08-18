import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole, isSessionPayload } from '@/lib/rbac';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clients = await prisma.client.findMany({ orderBy: { name: 'asc' } });
  return NextResponse.json({
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      reconciliationType: c.reconciliationType,
      reportingFrequency: c.reportingFrequency,
    })),
  });
}

export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const reconciliationType = body?.reconciliationType;
  const reportingFrequency = body?.reportingFrequency;

  if (!name) return NextResponse.json({ error: 'Client name is required' }, { status: 400 });
  if (!['full', 'partial'].includes(reconciliationType)) {
    return NextResponse.json({ error: 'reconciliationType must be full or partial' }, { status: 400 });
  }
  if (!['daily', 'weekly', 'monthly'].includes(reportingFrequency)) {
    return NextResponse.json({ error: 'reportingFrequency must be daily, weekly, or monthly' }, { status: 400 });
  }

  const existing = await prisma.client.findFirst({ where: { name } });
  if (existing) return NextResponse.json({ error: 'A client with that name already exists' }, { status: 409 });

  const client = await prisma.client.create({ data: { name, reconciliationType, reportingFrequency } });

  return NextResponse.json(
    { client: { id: client.id, name: client.name, reconciliationType: client.reconciliationType, reportingFrequency: client.reportingFrequency } },
    { status: 201 }
  );
}
