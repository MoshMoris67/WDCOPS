import crypto from 'crypto';
import { DEPLOYMENT } from '@/config/deployment';

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
// The template is expected to take three body variables, in this order:
//   {{1}} debtor name, {{2}} client name (e.g. the loan product), {{3}} outstanding balance,
//   {{4}} how to pay (per client, Client.whatsappPayInstruction)
// e.g. "Dear {{1}}, kindly make a payment towards your {{2}} of {{3}} which is overdue. {{4}} Reply STOP to opt out.".
// The amount goes through Meta's servers, so see WHATSAPP_ALLOW_REAL_DATA above.

const GRAPH_VERSION = 'v21.0';
const DEFAULT_PAY_INSTRUCTION = 'Please contact us to arrange payment.';

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

/** Balance as it appears in the message, in the deployment's base currency (UGX in Uganda,
 *  USD in the demo — stored amounts are never converted server-side), e.g. "UGX 563,572". */
export function formatAmount(amount: number): string {
  const digits = DEPLOYMENT.demo ? 2 : 0;
  return `${DEPLOYMENT.currencyCode} ${amount.toLocaleString(DEPLOYMENT.locale, { maximumFractionDigits: digits })}`;
}

export async function sendReminderTemplate(
  to: string,
  name: string,
  clientName: string,
  amount: number,
  payInstruction: string | null,
): Promise<SendResult> {
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
                { type: 'text', text: clientName.slice(0, 60) },
                { type: 'text', text: formatAmount(amount) },
                { type: 'text', text: (payInstruction?.trim() || DEFAULT_PAY_INSTRUCTION).slice(0, 120) },
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
