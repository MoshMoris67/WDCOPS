import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { toWhatsappNumber, verifyWebhookSignature } from '@/lib/whatsapp';

// Meta calls this directly, so it has no session — it is authenticated by the verify token
// (setup handshake) and the HMAC signature (every event). Reachable without login because
// the middleware matcher skips /api.

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === expected) {
    return new Response(q.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

interface StatusEvent { id: string; status: string; errors?: { title?: string; message?: string }[] }
interface InboundMessage { from: string; type: string; text?: { body?: string }; button?: { text?: string } }

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 3 };
const STOP_WORDS = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new Response('Bad signature', { status: 401 });
  }

  let body: { entry?: { changes?: { value?: { statuses?: StatusEvent[]; messages?: InboundMessage[] } }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      for (const s of value.statuses ?? []) {
        const row = await prisma.whatsappMessage.findUnique({ where: { waMessageId: s.id } });
        // Webhooks can arrive out of order; never move a message backwards (read -> delivered).
        if (!row || (RANK[s.status] ?? 0) < (RANK[row.status] ?? 0)) continue;
        await prisma.whatsappMessage.update({
          where: { id: row.id },
          data: { status: s.status, error: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? row.error },
        });
      }

      for (const m of value.messages ?? []) {
        const text = (m.text?.body ?? m.button?.text ?? '').trim().toLowerCase();
        const from = toWhatsappNumber(m.from);
        if (!from) continue;
        // Loan-file numbers are stored in whatever format the client used, so match on the
        // last 9 digits and then confirm with the normaliser.
        const candidates = await prisma.debtor.findMany({
          where: { OR: [{ phone1: { endsWith: from.slice(-9) } }, { phone2: { endsWith: from.slice(-9) } }] },
          select: { id: true, phone1: true, phone2: true },
          take: 20,
        });
        const matches = candidates.filter(
          (d) => toWhatsappNumber(d.phone1) === from || (d.phone2 && toWhatsappNumber(d.phone2) === from),
        );
        for (const d of matches) {
          await prisma.whatsappMessage.create({ data: { debtorId: d.id, direction: 'inbound', status: 'received' } });
          if (STOP_WORDS.includes(text)) {
            await prisma.debtor.update({ where: { id: d.id }, data: { whatsappOptedOutAt: new Date() } });
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
