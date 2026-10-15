# WhatsApp bulk reminders — setup

Phase 1 is **demo only**. The code refuses to send outside demo mode unless
`WHATSAPP_ALLOW_REAL_DATA=true` (see `src/lib/whatsapp.ts`), because sending routes debtor
names and numbers through Meta's servers.

## Environment variables (Render, demo)

| Variable | Value |
|---|---|
| `WHATSAPP_ENABLED` | `true` |
| `WHATSAPP_ACCESS_TOKEN` | Meta token (system-user token; a temporary one works for testing) |
| `WHATSAPP_PHONE_NUMBER_ID` | the sending number's ID from WhatsApp > API Setup |
| `WHATSAPP_VERIFY_TOKEN` | any string you choose; paste the same into Meta's webhook config |
| `WHATSAPP_APP_SECRET` | Meta app > Settings > Basic > App secret |
| `WHATSAPP_TEMPLATE_NAME` | default `payment_reminder` |
| `WHATSAPP_TEMPLATE_LANG` | default `en` |
| `WHATSAPP_DEFAULT_COUNTRY_CODE` | default `256`; set for the demo's recipient numbers |

Webhook URL to give Meta: `https://<your-render-host>/api/whatsapp/webhook`
(subscribe to the `messages` field).

## Template

Create a **utility** template named `payment_reminder` with two variables:

> Hello {{1}}, this is a friendly reminder about your loan {{2}}. Reply STOP to opt out.

No amounts, no threats or deadlines — Meta rejects aggressive collection wording.

## Flow

In demo mode, admins get a **WhatsApp** page in the sidebar (`/whatsapp-reminders`) that does
steps 1-3 below: pick a file, confirm consent, send a batch, and see delivery counts.

1. `POST /api/whatsapp/consent` `{ debtorIds, optedIn: true }` (admin) records consent.
2. `GET /api/whatsapp/reminders?fileId=` shows status and how many debtors are eligible.
3. `POST /api/whatsapp/reminders` `{ fileId }` or `{ debtorIds }` (admin) sends up to 200 per
   call. Debtors reminded in the last 24h, opted out, or with no balance are skipped.
4. Delivery status and STOP replies arrive on the webhook and update `WhatsappMessage` /
   `Debtor.whatsappOptedOutAt`.

On Meta's test number only recipients added to the allow-list (API Setup > "To") can receive.

## Where Meta business verification usually stalls

Check each in order at business.facebook.com > Settings > Security Center:
1. Business info (legal name, address, phone, website) matches your registration document exactly.
2. A document was uploaded (certificate of incorporation / tax or utility bill in the same name).
3. Domain verification of your website (DNS TXT or meta tag) — often the missed step.
4. The contact verification code (email/SMS/call) was entered.
5. Status is "In review" (wait, up to a few days), "Needs more info" (read the message and
   re-submit) or "Rejected" (appeal with a clearer document).
Separately, in WhatsApp Manager the display name and number must each show **Approved/Connected**.
