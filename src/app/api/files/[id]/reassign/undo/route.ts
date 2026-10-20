import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { undoReassignment, UndoReassignmentError } from '@/lib/undo-reassign';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.batchId !== 'string' || !body.batchId) {
    return NextResponse.json({ error: 'Redistribution batch is required' }, { status: 400 });
  }

  const file = await prisma.file.findUnique({
    where: { id },
    select: { id: true, isRecalled: true },
  });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  if (!file.isRecalled) {
    return NextResponse.json(
      { error: 'Recall the file before undoing its redistribution' },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(await undoReassignment(id, body.batchId));
  } catch (error) {
    if (error instanceof UndoReassignmentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
