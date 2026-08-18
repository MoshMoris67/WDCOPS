import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { buildReportSummary } from '@/lib/reports';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId') ?? '';
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!clientId || !from || !to) {
    return NextResponse.json({ error: 'clientId, from, and to are required' }, { status: 400 });
  }

  try {
    const summary = await buildReportSummary(clientId, new Date(`${from}T00:00:00`), new Date(`${to}T23:59:59`));
    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ error: 'Unknown client' }, { status: 404 });
  }
}
