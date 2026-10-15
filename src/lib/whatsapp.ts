import crypto from 'crypto';

// WhatsApp Business Cloud API (Meta) — server-side only. Configuration is entirely env:
//   WHATSAPP_ENABLED=true            master switch; everything below is inert without it
//   WHATSAPP_ACCESS_TOKEN            system-user token (a temporary 24h token works for the test number)
//   WHATSAPP_PHONE_NUMBER_ID         the sending number's ID (not the phone number itself)
//   WHATSAPP_VERIFY_TOKEN            any string you choose; Meta echoes it when verifying the webhook
//   WHATSAPP_APP_SECRET              Meta app secret; used to verify webhook signatures
//   WHATSAPP_TEMPLATE_NAME           approved template, default "payment_reminder"
//   WHATSAPP_TEMPLATE_LANG           template language code, default "en"
//   WHATSAPP_DEFAULT_COUNTRY_CODE    prefix for local-format numbers, default "256" (Uganda)
//   WHATSAPP_ALLOW_REAL_DATA=true    required to send outside demo mode: sending routes real
//                                    debtor names/numbers through Meta's servers, which the
//                                    self-hosted Uganda system must not do until agreed.
// The template is expected to take two body variables: {{1}} debtor name, {{2}} loan reference.
// Amounts are kept out of the message on purpose (privacy, and Meta's review of collection text).

const GRAPH_VERSION = 'v21.0';

export function isDemo(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
}

export interface WhatsappStatus {
  enabled: boolean;
  configured: boolean;
  allowed: boolean;
  reason?: string;
}

export function whatsappStatus(): WhatsappStatus {
  const enabled = process.env.WHATSAPP_ENABLED === 'true';
  const configured = !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  if (!enabled) return { enabled, configured, allowed: false, reason: 'WhatsApp is not enabled (WHATSAPP_ENABLED).' };
  if (!configured) return { enabled, configured, allowed: false, reason: 'WhatsApp credentials are not set.' };
  if (!isDemo() && process.env.WHATSAPP_ALLOW_REAL_DATA !== 'true') {
    return { enabled, configured, allowed: false, reason: 'Sending real debtor data via WhatsApp is not approved for this deployment.' };
  }
  return { enabled, configured, allowed: true };
}

/** Raw loan-file phone -> E.164 digits (no "+"), or null if it can't be a real number. */
export function toWhatsappNumber(raw: string): string | null {
  const cc = (process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ?? '256').replace(/\D/g, '');
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = cc + digits.slice(1);
  else if (!digits.startsWith(cc) && digits.length <= 9) digits = cc + digits;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export type SendResult = { ok: true; waMessageId: string } | { ok: false; error: string };

export async function sendReminderTemplate(to: string, name: string, loanRef: string): Promise<SendResult> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE_NAME ?? 'payment_reminder',
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: name.slice(0, 60) },
                { type: 'text', text: loanRef.slice(0, 60) },
              ],
            },
          ],
        },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    const id = json.messages?.[0]?.id;
    if (res.ok && id) return { ok: true, waMessageId: id };
    return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

/** Verifies Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifyWebhookSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = header.slice('sha256='.length);
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
