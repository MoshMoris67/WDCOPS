import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';

// Per-client "how to pay" line used as the 4th variable of the reminder template.
export async function GET() {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const clients = await prisma.client.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, whatsappPayInstruction: true },
  });
  return NextResponse.json({ clients });
}

// Body: { clientId: string, payInstruction: string } — empty string clears it.
export async function PATCH(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const body = (await req.json().catch(() => null)) as { clientId?: unknown; payInstruction?: unknown } | null;
  if (typeof body?.clientId !== 'string' || typeof body?.payInstruction !== 'string') {
    return NextResponse.json({ error: 'clientId and payInstruction are required' }, { status: 400 });
  }
  const text = body.payInstruction.trim();
  // Meta rejects variable values with newlines, tabs or 4+ spaces in a row.
  if (text.length > 120 || /[\n\t]| {4}/.test(text)) {
    return NextResponse.json({ error: 'Keep it to one line of at most 120 characters' }, { status: 400 });
  }
  await prisma.client.update({ where: { id: body.clientId }, data: { whatsappPayInstruction: text || null } });
  return NextResponse.json({ ok: true });
}
