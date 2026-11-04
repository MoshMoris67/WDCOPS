import { NextResponse } from 'next/server';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { buildPerformanceWorkbook } from '@/lib/performance-export';
import { monthKey } from '@/lib/performance-history';
import { attachmentDisposition } from '@/lib/content-disposition';

// Admin-only Excel download of whatever the History page is showing. Same parameters as
// /api/performance-history, plus ?view=overview|agent|compare.
export async function GET(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const p = new URL(req.url).searchParams;
  const view = p.get('view') === 'agent' ? 'agent' : p.get('view') === 'compare' ? 'compare' : 'overview';
  const result = await buildPerformanceWorkbook({
    view,
    period: p.get('period') || monthKey(new Date()),
    clientId: p.get('clientId') || undefined,
    fileId: p.get('fileId') || undefined,
    agentId: p.get('agentId') || undefined,
    agentA: p.get('agentA') || undefined,
    agentB: p.get('agentB') || undefined,
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  return new NextResponse(new Blob([new Uint8Array(result.buffer)]), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': attachmentDisposition(result.filename),
    },
  });
}
