import { NextResponse } from 'next/server';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { buildPerformanceReport, monthKey } from '@/lib/performance-history';

// Admin-only. ?period=2026-09 | 2026-Q3 (default: this month), optional &clientId= and &fileId=.
export async function GET(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const params = new URL(req.url).searchParams;
  const period = params.get('period') || monthKey(new Date());
  const report = await buildPerformanceReport(period, {
    clientId: params.get('clientId') || undefined,
    fileId: params.get('fileId') || undefined,
  });
  if (!report) return NextResponse.json({ error: 'period must look like 2026-09 or 2026-Q3' }, { status: 400 });
  return NextResponse.json(report);
}
