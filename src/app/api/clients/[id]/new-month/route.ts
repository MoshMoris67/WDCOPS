import { NextResponse } from 'next/server';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { planNewMonth, runNewMonth } from '@/lib/new-month';

/** Preview of what starting a new month would do for this client — nothing is changed. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const plan = await planNewMonth(id);
  if (!plan) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  return NextResponse.json({ plan });
}

/** Starts the new month for one client — see lib/new-month.ts's runNewMonth. Irreversible,
 *  so the caller must echo the client's name back (the UI asks the admin to type it) and
 *  is expected to have downloaded the export first. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const plan = await planNewMonth(id);
  if (!plan) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const typed = typeof body?.confirmName === 'string' ? body.confirmName.trim().toLowerCase() : '';
  if (typed !== plan.clientName.trim().toLowerCase()) {
    return NextResponse.json({ error: 'Type the client name exactly to confirm' }, { status: 400 });
  }

  try {
    const result = await runNewMonth(id);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('Start new month failed', err);
    return NextResponse.json({ error: 'Could not start the new month — nothing was changed. Try again or contact IT' }, { status: 500 });
  }
}
