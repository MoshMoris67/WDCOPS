import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

// How long after logging a disposition an agent may correct it themselves — after this
// window (or for a disposition another agent logged) only an admin can fix it.
const SELF_CORRECTION_WINDOW_MS = 60 * 1000;

/** Corrects a mis-logged disposition in place, preserving the pre-correction values in
 *  CallLogCorrection — see the append-only-history convention that model's comment
 *  describes. Agents may correct their own disposition within one minute of logging it;
 *  admins may correct any disposition at any time. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await params;
  const log = await prisma.callLog.findUnique({ where: { id } });
  if (!log) return NextResponse.json({ error: 'Call log not found' }, { status: 404 });

  if (session.role !== 'admin') {
    if (log.agentId !== session.sub) {
      return NextResponse.json({ error: 'You can only correct dispositions you logged yourself' }, { status: 403 });
    }
    if (Date.now() - log.createdAt.getTime() > SELF_CORRECTION_WINDOW_MS) {
      return NextResponse.json(
        { error: 'This disposition can no longer be self-corrected — it was logged more than a minute ago. Ask an admin to fix it.' },
        { status: 403 }
      );
    }
  }

  const body = await req.json().catch(() => null);
  const dispositionCode = typeof body?.dispositionCode === 'string' ? body.dispositionCode : '';
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const promisedAmount = body?.promisedAmount ? Number(body.promisedAmount) : null;
  const promisedDate = typeof body?.promisedDate === 'string' && body.promisedDate ? new Date(body.promisedDate) : null;

  if (!dispositionCode) {
    return NextResponse.json({ error: 'dispositionCode is required' }, { status: 400 });
  }
  // Same guard as the create route — an unbounded native date input can otherwise spin
  // into a year Prisma can't encode.
  if (promisedDate && (Number.isNaN(promisedDate.getTime()) || promisedDate.getFullYear() > new Date().getFullYear() + 5)) {
    return NextResponse.json({ error: 'promisedDate is not a valid date' }, { status: 400 });
  }

  const code = await prisma.dispositionCode.findUnique({ where: { code: dispositionCode } });
  if (!code) return NextResponse.json({ error: `Unknown disposition code: ${dispositionCode}` }, { status: 400 });

  const [, updated] = await prisma.$transaction([
    prisma.callLogCorrection.create({
      data: {
        callLogId: log.id,
        correctedById: session.sub,
        previousDispositionCode: log.dispositionCode,
        previousNote: log.note,
        previousPromisedAmount: log.promisedAmount,
        previousPromisedDate: log.promisedDate,
      },
    }),
    prisma.callLog.update({
      where: { id: log.id },
      data: { dispositionCode, note, promisedAmount, promisedDate, editedAt: new Date() },
      include: { agent: true },
    }),
  ]);

  return NextResponse.json({
    log: {
      id: updated.id,
      disposition: updated.dispositionCode,
      note: updated.note,
      promisedAmount: updated.promisedAmount,
      promisedDate: updated.promisedDate,
      createdAt: updated.createdAt,
      agentId: updated.agentId,
      agentName: updated.agent.name,
      synced: true,
      editedAt: updated.editedAt,
    },
  });
}
