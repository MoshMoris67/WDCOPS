import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import type { CallLog } from '@prisma/client';

// A queued call older than this (by the device's own reckoning) is stamped with the sync
// time instead of being backdated — past this point a wildly wrong device clock is a more
// likely explanation than an agent genuinely offline that long.
const MAX_OFFLINE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** When the agent actually logged the call, in server time. The offline queue sends both
 *  the device time it queued the call (queuedAt) and the device time it's sending it
 *  (sentAt) — only their difference is used, so a device clock that's simply set wrong
 *  cancels out instead of backdating (or future-dating) the call. Anything missing or
 *  implausible falls back to now, which is exactly the old behavior. */
function resolveCreatedAt(body: { queuedAt?: unknown; sentAt?: unknown } | null): Date {
  const now = Date.now();
  const queuedAt = typeof body?.queuedAt === 'string' ? Date.parse(body.queuedAt) : NaN;
  const sentAt = typeof body?.sentAt === 'string' ? Date.parse(body.sentAt) : NaN;
  const ageMs = sentAt - queuedAt;
  if (!Number.isFinite(ageMs) || ageMs <= 0 || ageMs > MAX_OFFLINE_AGE_MS) return new Date(now);
  return new Date(now - ageMs);
}

function logResponse(log: CallLog & { agent: { name: string } }) {
  return {
    log: {
      id: log.id,
      disposition: log.dispositionCode,
      note: log.note,
      promisedAmount: log.promisedAmount,
      promisedDate: log.promisedDate,
      createdAt: log.createdAt,
      agentName: log.agent.name,
      synced: true,
    },
  };
}

/** A retry of a call that already reached the server: the saved row if this caller owns
 *  it, a 409 if somehow another account does, or null if it was never saved. */
async function findExisting(clientRequestId: string, agentId: string) {
  const existing = await prisma.callLog.findUnique({ where: { clientRequestId }, include: { agent: true } });
  if (!existing) return null;
  if (existing.agentId !== agentId) {
    return NextResponse.json({ error: 'This request belongs to another account' }, { status: 409 });
  }
  return NextResponse.json(logResponse(existing), { status: 200 });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  // Optional — sent by the offline queue (see lib/offline-sync.ts). Without it, every
  // request creates a new row, same as before this existed.
  const clientRequestId =
    typeof body?.clientRequestId === 'string' && body.clientRequestId.trim() && body.clientRequestId.length <= 100
      ? body.clientRequestId.trim()
      : null;
  const debtorId = typeof body?.debtorId === 'string' ? body.debtorId : '';
  const dispositionCode = typeof body?.dispositionCode === 'string' ? body.dispositionCode : '';
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const promisedAmount = body?.promisedAmount ? Number(body.promisedAmount) : null;
  const promisedDate = typeof body?.promisedDate === 'string' && body.promisedDate ? new Date(body.promisedDate) : null;

  if (!debtorId || !dispositionCode) {
    return NextResponse.json({ error: 'debtorId and dispositionCode are required' }, { status: 400 });
  }

  // Checked before any validation below: the original request already passed it, and the
  // world may have moved on since (debtor reassigned, code retired) — the call still
  // happened and is still saved, so a retry must report success, not a fresh rejection.
  if (clientRequestId) {
    const existing = await findExisting(clientRequestId, session.sub);
    if (existing) return existing;
  }

  // A native date input has no upper bound on its own — a stray mouse-wheel scroll or held
  // arrow key over the year segment can spin it into the tens of thousands. Prisma can't
  // encode a year that large (its extended-ISO form isn't valid DateTime wire format) and
  // throws, which without this check surfaces as an uncaught 500 — and offline-sync.ts
  // treats any 5xx as retryable, so a record like this gets resent forever instead of
  // landing in the 'failed' queue where an agent could actually see and discard it.
  if (promisedDate && (Number.isNaN(promisedDate.getTime()) || promisedDate.getFullYear() > new Date().getFullYear() + 5)) {
    return NextResponse.json({ error: 'promisedDate is not a valid date' }, { status: 400 });
  }

  const code = await prisma.dispositionCode.findUnique({ where: { code: dispositionCode } });
  if (!code) return NextResponse.json({ error: `Unknown disposition code: ${dispositionCode}` }, { status: 400 });

  const debtor = await prisma.debtor.findUnique({ where: { id: debtorId } });
  if (!debtor) return NextResponse.json({ error: 'Debtor not found' }, { status: 404 });
  if (session.role === 'agent' && debtor.assignedAgentId !== session.sub) {
    return NextResponse.json({ error: 'This debtor is not assigned to you' }, { status: 403 });
  }

  let log;
  try {
    log = await prisma.callLog.create({
      data: {
        clientRequestId,
        debtorId,
        agentId: session.sub,
        dispositionCode,
        note,
        promisedAmount,
        promisedDate,
        createdAt: resolveCreatedAt(body),
        syncedAt: new Date(),
      },
      include: { agent: true },
    });
  } catch (err) {
    // Two copies of the same retry raced past the lookup above and the other one won the
    // unique index — same outcome as finding it there.
    if (clientRequestId && (err as { code?: string })?.code === 'P2002') {
      const existing = await findExisting(clientRequestId, session.sub);
      if (existing) return existing;
    }
    throw err;
  }

  return NextResponse.json(logResponse(log), { status: 201 });
}
