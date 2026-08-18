import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole, isSessionPayload } from '@/lib/rbac';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const codes = await prisma.dispositionCode.findMany({ orderBy: { code: 'asc' } });
  return NextResponse.json({ codes });
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() || null : null;
  const color = typeof body?.color === 'string' && HEX_COLOR.test(body.color) ? body.color : '#64748B';
  const requiresCallback = Boolean(body?.requiresCallback);
  const requiresPtp = Boolean(body?.requiresPtp);

  if (!/^[A-Z0-9]{1,6}$/.test(code)) {
    return NextResponse.json({ error: 'Code must be 1-6 letters/numbers, e.g. CB' }, { status: 400 });
  }
  if (!label) return NextResponse.json({ error: 'Label is required' }, { status: 400 });

  const existing = await prisma.dispositionCode.findUnique({ where: { code } });
  if (existing) return NextResponse.json({ error: `Code ${code} already exists` }, { status: 409 });

  const created = await prisma.dispositionCode.create({
    data: { code, label, description, color, requiresCallback, requiresPtp },
  });

  return NextResponse.json({ code: created }, { status: 201 });
}
