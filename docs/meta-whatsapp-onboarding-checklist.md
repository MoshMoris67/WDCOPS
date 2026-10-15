# Meta / WhatsApp Business onboarding checklist

Work top to bottom. Meta's screens and names change often, so treat the wording as a guide.
Do Part A and B for the **demo** now (no verification needed). Part C onward is for the
**Uganda number** and needs business verification.

## A. Before you start (gather these)
- [ ] Facebook account of the person who will own the business assets (use a company-controlled login, not a personal one that might leave).
- [ ] Legal business name exactly as registered, registered address, business phone and email, website URL.
- [ ] Registration document (certificate of incorporation or equivalent) and one proof of address or tax document in the same legal name.
- [ ] Control of the website domain (able to add a DNS TXT record or a meta tag) and of an email address on that domain.
- [ ] A spare phone number that is NOT registered on WhatsApp or WhatsApp Business (delete that account first if it is), and that can receive an SMS or voice call.
- [ ] A payment method for Meta (card) — needed before you can send business-initiated messages at scale.

## B. Demo setup (Meta test number, no verification)
- [ ] developers.facebook.com > My Apps > Create App > type **Business** > add the **WhatsApp** product.
- [ ] WhatsApp > API Setup: note the **test phone number ID** and **WhatsApp Business Account ID**.
- [ ] Add up to 5 recipient numbers under "To" and verify each with the code WhatsApp sends.
- [ ] Create a token: temporary (24h) for a first test, or a **System User** token (Business Settings > Users > System users > Generate token with `whatsapp_business_messaging` and `whatsapp_business_management`) so it does not expire.
- [ ] App > Settings > Basic: copy the **App secret**.
- [ ] WhatsApp > Configuration > Webhook: callback URL `https://<render-host>/api/whatsapp/webhook`, verify token = your `WHATSAPP_VERIFY_TOKEN`; subscribe to **messages**.
- [ ] WhatsApp Manager > Message templates: create `payment_reminder` (category **Utility**, language English) with two variables; wait for Approved. Text in `docs/whatsapp-setup.md`.
- [ ] Set the Render environment variables from `docs/whatsapp-setup.md` and redeploy.
- [ ] Send yourself a test from the Reminders page.

## C. Business verification (needed for the Uganda number)
In business.facebook.com > Business settings > Security Center:
- [ ] Business info matches the registration document character for character (name, address, phone).
- [ ] Start verification and upload the documents from Part A.
- [ ] **Verify the domain**: Brand Safety > Domains, add your domain, then add the DNS TXT record (or meta tag) Meta gives you. This is the most commonly missed step.
- [ ] Complete the contact check (email, SMS or call code).
- [ ] Wait for status. "In review": wait (can take several days). "Needs more info": read the message, fix exactly that, resubmit. "Rejected": appeal with clearer documents or a corrected name.
- [ ] Once verified, enable **two-factor authentication** for the business (often required for messaging access).

## D. Production number and display name
- [ ] WhatsApp Manager > Phone numbers > Add phone number; enter the spare number and confirm the SMS/voice code.
- [ ] Set the **display name** (must match your brand/legal name; avoid generic words). Wait for Approved.
- [ ] Add a payment method and confirm the WhatsApp Business Account is linked to it.
- [ ] Set the profile: description, address, website, category, logo.
- [ ] Register the number for the Cloud API (the app does this during setup; otherwise `POST /{phone-number-id}/register` with a 6-digit PIN you keep safe).
- [ ] Create a **new System User token** for the production WABA and keep it in the server's secrets only.

## E. Templates and consent (policy)
- [ ] Recreate `payment_reminder` on the production WABA; keep it neutral: no threats, deadlines, or legal language, and include an opt-out line.
- [ ] Decide how consent is collected (loan signup form, or customer messages us first) and keep a record. A phone number in a loan file is not consent.
- [ ] Check Uganda's Data Protection and Privacy Act, 2019 and your client contracts before sending any real debtor data through Meta. This is also the condition for setting `WHATSAPP_ALLOW_REAL_DATA=true`.
- [ ] Watch the number's **quality rating** in WhatsApp Manager; many blocks or reports lower your sending limit.

## F. Office server (Uganda only)
- [ ] A public HTTPS URL for `/api/whatsapp/webhook`. The server already uses Tailscale Funnel; the same can expose just this path. Without it sends work but delivery status and STOP replies do not arrive.
- [ ] Production env vars set on the server (see `docs/whatsapp-setup.md`), with the Uganda country code `256`.
- [ ] Webhook verified in Meta (green tick) and a test send to one staff number.

## G. Costs to expect
- Meta charges per template message by category and country; replies within 24h of a customer message are free. Check Meta's current rate card for Uganda before the first bulk send.
- New numbers start with a low daily limit (commonly 250 unique recipients per day) that rises as quality stays good, and after business verification.
