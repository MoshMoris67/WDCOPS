import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { sendReminderTemplate, toWhatsappNumber, whatsappStatus } from '@/lib/whatsapp';

const MAX_PER_REQUEST = 200;

// Opted in, not opted out, still owes money, and not already reminded in the last 24h
// (a failed attempt doesn't count) — so repeating a capped batch never double-sends.
function eligibleWhere() {
  return {
    whatsappOptedInAt: { not: null },
    whatsappOptedOutAt: null,
    balance: { gt: 0 },
    whatsappMessages: {
      none: {
        direction: 'outbound',
        status: { not: 'failed' },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    },
  };
}

// Admin-only status + eligible count, so the UI can say why sending is unavailable.
export async function GET(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const fileId = new URL(req.url).searchParams.get('fileId') ?? undefined;
  const eligible = await prisma.debtor.count({
    where: { ...(fileId ? { fileId } : {}), ...eligibleWhere() },
  });
  return NextResponse.json({ ...whatsappStatus(), eligible, maxPerRequest: MAX_PER_REQUEST });
}


// Bulk reminder: sends the approved template to opted-in debtors with a balance, either an
// explicit list or everyone in a file. Body: { debtorIds?: string[], fileId?: string }.
// Capped per request; send sequentially so Meta's rate limits are never the thing that fails.
export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const status = whatsappStatus();
  if (!status.allowed) return NextResponse.json({ error: status.reason }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { debtorIds?: unknown; fileId?: unknown } | null;
  const ids = Array.isArray(body?.debtorIds) ? body.debtorIds.filter((x): x is string => typeof x === 'string') : [];
  const fileId = typeof body?.fileId === 'string' ? body.fileId : undefined;
  if (!ids.length && !fileId) {
    return NextResponse.json({ error: 'Provide debtorIds or fileId' }, { status: 400 });
  }

  const debtors = await prisma.debtor.findMany({
    where: { ...eligibleWhere(), ...(ids.length ? { id: { in: ids } } : { fileId }) },
    select: { id: true, name: true, phone1: true, phone2: true, loanRef: true },
    take: MAX_PER_REQUEST,
  });

  const templateName = process.env.WHATSAPP_TEMPLATE_NAME ?? 'payment_reminder';
  let sent = 0;
  let failed = 0;
  let skippedNoNumber = 0;

  for (const d of debtors) {
    const to = toWhatsappNumber(d.phone1) ?? (d.phone2 ? toWhatsappNumber(d.phone2) : null);
    if (!to) {
      skippedNoNumber++;
      continue;
    }
    const result = await sendReminderTemplate(to, d.name, d.loanRef);
    await prisma.whatsappMessage.create({
      data: {
        debtorId: d.id,
        direction: 'outbound',
        templateName,
        status: result.ok ? 'sent' : 'failed',
        waMessageId: result.ok ? result.waMessageId : null,
        error: result.ok ? null : result.error,
        createdById: session.sub,
      },
    });
    if (result.ok) sent++;
    else failed++;
  }

  // If the cap truncated the batch the caller just repeats the request; the 24h rule in
  // eligibleWhere() skips everyone already reminded.
  return NextResponse.json({ sent, failed, skippedNoNumber, considered: debtors.length, capped: debtors.length === MAX_PER_REQUEST });
}
