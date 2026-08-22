import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { BUCKET_ORDER } from '@/lib/commission';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const rates = await prisma.commissionRate.findMany({ where: { clientId }, orderBy: { bucket: 'asc' } });
  return NextResponse.json({ rates });
}

export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const body = await req.json().catch(() => null);
  const clientId = typeof body?.clientId === 'string' ? body.clientId : '';
  const bucket = typeof body?.bucket === 'string' ? body.bucket : '';
  const rate = Number(body?.rate);

  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!BUCKET_ORDER.includes(bucket as (typeof BUCKET_ORDER)[number])) {
    return NextResponse.json({ error: `bucket must be one of: ${BUCKET_ORDER.join(', ')}` }, { status: 400 });
  }
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
    return NextResponse.json({ error: 'rate must be a fraction between 0 and 1, e.g. 0.07 for 7%' }, { status: 400 });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: 'Unknown client' }, { status: 400 });

  const existing = await prisma.commissionRate.findUnique({ where: { clientId_bucket: { clientId, bucket } } });
  if (existing) return NextResponse.json({ error: `A rate for ${bucket} already exists for this client — edit it instead` }, { status: 409 });

  const created = await prisma.commissionRate.create({ data: { clientId, bucket, rate } });
  return NextResponse.json({ rate: created }, { status: 201 });
}
