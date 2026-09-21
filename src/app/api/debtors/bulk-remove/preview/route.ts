import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { loadTable, SUPPORTED_IMPORT_EXTENSIONS } from '@/lib/excel';

/**
 * Reads a client's "these accounts were insourced" list (loan/account ref, one per row,
 * an optional header row) and matches it against that client's debtors across every file
 * batch they've ever been imported in — not just one. Read-only: nothing is deleted here,
 * this only tells the admin what would be deleted so they can review before confirming
 * via POST /api/debtors/bulk-remove.
 */
export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });

  const clientId = String(form.get('clientId') ?? '');
  const file = form.get('file');

  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: 'A file is required' }, { status: 400 });
  if (!SUPPORTED_IMPORT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return NextResponse.json({ error: `Unsupported file type — use ${SUPPORTED_IMPORT_EXTENSIONS.join(' or ')}` }, { status: 400 });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: 'Unknown client' }, { status: 400 });

  const buffer = await file.arrayBuffer();
  let table: string[][];
  try {
    table = await loadTable(buffer, file.name);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read this file' }, { status: 400 });
  }

  // First column only — this is a plain list of references, not a mapped debtor import.
  // The first row is treated as a header (client-provided lists are near-universally
  // headered, e.g. "Loan Ref" / "Account No.") and dropped; a genuinely headerless list
  // loses its first row, which is an acceptable edge case for a one-off admin action.
  const rows = table.slice(1);
  const refsInOrder = rows.map((r) => (r[0] ?? '').trim()).filter((v) => v.length > 0);
  const uniqueRefs = [...new Set(refsInOrder)];

  if (uniqueRefs.length === 0) {
    return NextResponse.json({ error: 'No account references found in the first column of this file' }, { status: 400 });
  }

  const matches = await prisma.debtor.findMany({
    where: { loanRef: { in: uniqueRefs }, file: { clientId } },
    select: {
      id: true,
      loanRef: true,
      name: true,
      balance: true,
      file: { select: { batchLabel: true } },
      assignedAgent: { select: { name: true } },
    },
  });

  const matchedRefs = new Set(matches.map((m) => m.loanRef));
  const unmatchedRefs = uniqueRefs.filter((r) => !matchedRefs.has(r));

  return NextResponse.json({
    matched: matches.map((m) => ({
      id: m.id,
      loanRef: m.loanRef,
      name: m.name,
      balance: m.balance,
      batchLabel: m.file.batchLabel,
      agentName: m.assignedAgent?.name ?? null,
    })),
    unmatchedRefs,
  });
}
