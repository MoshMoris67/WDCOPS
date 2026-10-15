import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { audienceWhere, parseDispositions } from '@/lib/whatsapp-audience';
import { requireRole, isSessionPayload } from '@/lib/rbac';

// Admin records that debtors have agreed to WhatsApp reminders (consent is collected
// outside the app — e.g. at loan signup — this only records it). Body:
//   { debtorIds: string[] | fileId: string [+ dispositions: string[]], optedIn: boolean }
// A fileId records it for every debtor in that file — the admin is attesting consent for the
// whole batch, so the UI makes them confirm that explicitly.
export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const body = (await req.json().catch(() => null)) as { debtorIds?: unknown; fileId?: unknown; dispositions?: unknown; optedIn?: unknown } | null;
  const ids = Array.isArray(body?.debtorIds) ? body.debtorIds.filter((x): x is string => typeof x === 'string') : [];
  const fileId = typeof body?.fileId === 'string' ? body.fileId : undefined;
  const dispositions = parseDispositions(body?.dispositions);
  if (!ids.length && fileId && !dispositions.length) {
    return NextResponse.json({ error: 'Choose at least one disposition to record consent for' }, { status: 400 });
  }
  if ((!ids.length && !fileId) || ids.length > 5000 || typeof body?.optedIn !== 'boolean') {
    return NextResponse.json({ error: 'debtorIds (1-5000) or fileId, and optedIn (boolean), are required' }, { status: 400 });
  }

  const now = new Date();
  const result = await prisma.debtor.updateMany({
    where: ids.length ? { id: { in: ids } } : await audienceWhere(fileId, dispositions),
    data: body.optedIn
      ? { whatsappOptedInAt: now, whatsappOptedOutAt: null }
      : { whatsappOptedOutAt: now },
  });
  return NextResponse.json({ updated: result.count });
}
