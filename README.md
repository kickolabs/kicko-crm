# Kicko CRM

Multi-tenant CRM for visa & immigration consultancies.

- **Phase 1:** agencies, team & roles, leads, clients, cases, tasks, calendar, walk-in kiosk, web-form capture.
- **Phase 4:** WhatsApp Cloud API: shared inbox (leads + clients), 24-hour window, templates, automations, opt-in, attachments → documents, portal links on WhatsApp; sandbox + simulator.
- **Phase 3:** client portal (one-time login links, journey, document uploads, invoices & receipts, pay, messages, booking), staff inbox.
- **Phase 2:** document checklists (upload, versions, verify/reject, expiry), GST invoices with installments, payments & receipts (PDF), Razorpay payment links, partner institutions & courses, study applications, commission claims, daily reminders.

## Stack

Next.js 15 (App Router) · React 19 · Tailwind 4 · Prisma 6 · PostgreSQL (row-level security) · Better-Auth · Zod · Playwright · Vitest

```
apps/web        Next.js app: staff console (/[workspace]), public forms (/f), auth, APIs
packages/db     Prisma schema, migrations (incl. RLS policies), withTenant(), visa catalog, provisioning
e2e             Playwright end-to-end tests
```

## Run locally

Requires Node 22+. There's no Docker or Postgres install: `embedded-postgres` runs a real Postgres from npm.

```bash
npm install
cp .env.example .env              # then set BETTER_AUTH_SECRET to a random 32+ char string
npm run db:start                  # terminal 1: Postgres on :5433 (keep running)
npm run db:migrate                # first time only (creates tables + RLS policies)
npm run dev                       # terminal 2: http://localhost:3000
npm run db:seed:demo              # optional: demo agency (needs the app running)
```

Demo login: `demo@kicko.app` / `demo-pass-123` → http://localhost:3000/demo

## Tests

```bash
npm test                          # RLS tenant-isolation tests (packages/db)
npm run e2e                       # browser tests on a production build (:3100, built automatically); needs the db
VISUAL=1 npx playwright test visual   # screenshots of demo screens → test-results/visual
```

## How tenant isolation works

- Workspaces live at `/{slug}` (Linear-style paths, so one login covers every agency a user belongs to).
- Every tenant table has a `tenantId` column and a Postgres RLS policy `tenantId = current_setting('app.tenant_id')`.
- The app connects as `kicko_app`, a role that is neither superuser nor table owner, so RLS always applies. Migrations run as the owner via `DIRECT_URL`.
- All tenant queries go through `withTenant(tenantId, tx => …)`, which sets `app.tenant_id` for that transaction. Without it, queries return nothing.
- `packages/db/test/rls.test.ts` proves cross-tenant reads, writes and deletes are blocked.

## Documents & storage

`STORAGE_DRIVER=local` keeps files in `./.storage` (dev). In production set `STORAGE_DRIVER=s3` with Cloudflare R2 credentials (`S3_*` in `.env.example`). Browsers upload and download with short-lived signed URLs; keys are namespaced `tenants/{tenantId}/…` and only issued after a row-level-security-checked lookup.

## Integrations (pluggable providers)

Every external service is a capability behind an interface in `apps/web/src/integrations/` (`payments/port.ts`, `messaging/port.ts`, `storage/port.ts`, `email/port.ts`), with one adapter per provider and a **sandbox adapter for each** so everything works without vendor accounts.

- Agencies connect their own accounts per capability (`ProviderConnection` table, one row per workspace and capability; secret fields AES-256-GCM encrypted with `ENCRYPTION_KEY`, never sent back to the browser).
- Settings → Integrations shows every capability, its status and 30-day usage (`UsageEvent`, metered on every send, link and payment). Connect forms are generated from each provider's descriptor.
- One webhook URL pattern: `https://<app>/api/webhooks/{capability}/{provider}/{workspace}`. The adapter verifies the signature with the agency's secret and returns normalised events. A URL for a provider the workspace no longer uses returns 404.
- **Adding a provider:** write an adapter file that exports a `ProviderDescriptor` (fields, feature flags, `create()`), and list it in `integrations/core/registry.ts`. The settings form, webhook route and usage tracking pick it up automatically.

## Payments

Settings → Billing → *Online payment links*. **Sandbox payments** (no account) create links to an in-app test checkout, which sends a signed webhook just like a real gateway. **Razorpay**: enter the agency's own keys, then in the Razorpay dashboard add the webhook `https://<app>/api/webhooks/payments/razorpay/{workspace}` for `payment_link.paid` with the same secret. Paid links record the payment, allocate it to installments and issue a receipt. Retries are idempotent on the gateway payment id.

## Client portal

Clients use `/portal/{workspace}`. Staff send a one-time link from the client's profile, by copying it, sharing it on WhatsApp, or emailing it once `RESEND_API_KEY` is set. Clients can also request a link by email. Opening a link needs a click (POST), so email scanners can't use up the token. Sessions last 30 days, the cookie is scoped to `/portal/{workspace}`, and every portal query is pinned to that one client on top of row-level security. Staff can revoke access at any time.

## WhatsApp

Settings → WhatsApp. **Sandbox** (no Meta account) works end to end inside Kicko: outbound messages are recorded instead of sent, and the built-in simulator posts real, signed Meta-format webhooks to the agency's endpoint. **Live**: enter the Phone number ID, WhatsApp Business Account ID, a permanent System User token and the app secret, then set the callback URL `https://<app>/api/webhooks/messaging/whatsapp-cloud/{workspace}` and the verify token in Meta (subscribe to `messages`). Create the suggested templates (same names) in Meta Business Manager and press *Sync from Meta*.

- New numbers become leads (source WhatsApp); converting a lead carries the conversation over.
- Free-form replies only inside the 24-hour customer-service window; otherwise approved templates.
- Template sends and automations need opt-in (web form/kiosk checkbox, staff-recorded, or the customer messaging first).
- Webhooks are signature-checked (`X-Hub-Signature-256`) and idempotent on the message id; statuses never move backwards.
- Not yet tested against a real Meta number (no account). Do that before going live.

## WhatsApp AI assistant

Settings → AI assistant. Choose **Off**, **Always on** or **Outside office hours**, and write the agency's own answers in the knowledge base. There are starter answers to edit, and a *Try it* chat to test with.

- On each inbound WhatsApp message (debounced, so a burst of messages gets one reply), the assistant reads the agency's answers plus the customer's own record: case stage, documents still needed, next appointment, amount due. Then Claude decides one turn: the reply, details to save (name, email, destination, visa type, notes), a slot to book (from the portal booking hours and the counsellor's calendar), or a handoff.
- It never gives immigration advice or guarantees. Complaints, requests for a person, and anything it's unsure about are handed to a human: the chat is flagged in the inbox and a priority task goes to the owner. Staff can **Take over** or **Resume AI** per chat, and any staff reply pauses it for 12 hours. Replying STOP opts the customer out. At most 30 AI replies per contact per day.
- Without `ANTHROPIC_API_KEY` it runs in sandbox: keyword rules plus knowledge-base matching, English only.

## Plans & billing (Kicko charging agencies)

Settings → **Plan & billing**. Plans are defined in `apps/web/src/lib/plans.ts` (prices per user per month, before GST):

| | Starter | Growth | Pro |
|---|---|---|---|
| Yearly / monthly (INR) | ₹999 / ₹1,199 | ₹1,999 / ₹2,399 | ₹3,499 / ₹4,199 |
| Adds | core CRM, WhatsApp | calling + AI notes, WhatsApp AI, payment links, eligibility, form sheets | voice agent, sub-agents, AI document checks, custom fields, API |
| AI credits / user / month | 100 | 300 | 1,000 |

- **Trial:** new workspaces get 14 days of everything, with 200 AI credits. Existing workspaces were set to a complimentary Pro plan.
- **Seats:** limit active members plus pending invites.
- **AI credits:** charged per AI action (call notes 4, voice notes 2, WhatsApp AI reply 1, document check 1), only when a real model runs. The monthly allowance resets on the 1st. Purchased credits (1,000 for ₹1,499 + GST) never expire. When credits run out, AI steps pause; the CRM never does.
- **Plan gating:** enforced on the server for each feature; screens show an upgrade card.
- **Lifecycle** (daily job): trial ends or the period lapses → payment due (7 days) → **read-only** (30 days) → **suspended**, with emails at each step.
  - Read-only is enforced by Postgres: staff transactions run `SET TRANSACTION READ ONLY`. Viewing and export work, edits are refused, and incoming WhatsApp, payments and webhooks keep working.
  - Suspended shows a renew screen. Data is kept for 90 days.
- **Payments:** Razorpay Subscriptions on Kicko's own account (see `.env.example`), with a sandbox checkout until then. Each payment creates a **GST tax invoice** from Kicko (`KCK/26-27/0001`): CGST + SGST, or IGST when the agency's GSTIN is in another state.

## Government form answer sheets

Client → **Forms** tab. These are copy-ready answer sheets for the forms consultants fill most:
- **Canada:** IRCC personal details and background, and IMM 5645 family information
- **Australia:** ImmiAccount personal particulars (the core of Form 80)
- **USA:** DS-160

Each sheet lists the form's questions in its own order and date format (IRCC 1999-04-12 · DS-160 12-APR-1999 · ImmiAccount 12 Apr 1999), with copy buttons, "Copy all" and a PDF export.

- Answers come from the profile. Anything the profile doesn't hold (place of birth, parents, travel history, refusals and so on) is a shared question, stored once per client and reused by every form.
- **Ask client** sends the missing questions to the client portal ("Your consultant needs N details"). A "Yes" to a background question needs details. Each answer shows who gave it: Profile, Client answered or Staff.
- Why sheets, not filled PDFs: official IRCC PDFs are locked (XFA) and can't be filled by software, and ImmiAccount and DS-160 are online-only. Consultants type into portals, so the sheet is what saves the time.
- To add a form, define it in `lib/forms/sheet.ts`. Its questions reuse the shared catalog in `lib/forms/questions.ts`.

## Sub-agent network

Partners → **Sub-agents**. Add the agents and freelance counsellors who refer clients, with their commission rule: a **% of every payment** the referred client makes (excluding GST, pro rata for part payments), or a **fixed fee** per client who signs up.

- **Partner portal** at `/partner/{workspace}`, with one-time sign-in links (staff create one, or partners request it by email). Partners refer clients (with a consent tick) and see only their own referrals' progress (status and case stage, no notes, documents or messages) and their commission statement.
- **First come, first served:** a referral for someone already in the system isn't reassigned. The partner is told, and staff see the attempt on that lead's timeline.
- **Commission accrues automatically** when payments are recorded (manual, payment link or portal), or on conversion for fixed fees. Mark payouts paid with a reference (UTR). Deactivating an agent ends their portal access immediately.
- Staff can also set "Referred by" on any lead.

## Eligibility calculators

Client → **Eligibility** tab: **Canada Express Entry CRS** (out of 1,200) and the **Australia points test** (pass mark 65).

- Scores are computed by code from the published IRCC and Home Affairs points tables (`lib/eligibility`), live as you type, never by AI. Unit tests cover worked examples.
- Answers are pre-filled from the profile (age, education, IELTS/CELPIP → CLB, work years), with each assumption listed.
- "Ways to add points" are real recalculations (better English, French, PNP, state nomination, NAATI…). **Save & explain** stores the result with a plain-English explanation. The AI only phrases it, and every number comes from the calculator.
- Estimates, not legal advice. Arranged-employment points are not counted (IRCC removed them in March 2025).

## AI document checks

Every upload (staff or client portal) is checked in the background:
- The AI reads the file: what document it is, whether it's legible, name, date of birth, number and expiry.
- Code then compares those with the client's profile: name (order-insensitive), date of birth and passport number. It also flags documents that are expired or expire soon (passports: under 6 months).
- Findings show on the checklist ("AI: 1 issue…") and in the review window, which can also fill in the expiry date. A person still verifies every document.
- Turn it off in Settings → Integrations → AI features. Without `ANTHROPIC_API_KEY`, the sandbox can only judge the file name, type and size.

## AI voice agent

Settings → AI voice agent. Connect **Bolna** (Indian languages and numbers), **Retell** (elsewhere), or the **sandbox** (scripted callers, no phones ring).

- **Qualification calls:** the *AI call* button on a lead, or automatic calls to new enquiries from chosen sources (web form, ads…) after a configurable delay. The agent says it's an AI and that the call is recorded, asks the questions you pick (destination, visa type, intake, education, English test, budget…), offers a free consultation and books it. It never gives immigration advice.
- **AI receptionist:** answers the agent's number, recognises existing clients (case stage, documents still needed, next appointment) and takes new enquiries.
- **Tools mid-call:** `get_caller_context`, `save_lead_details`, `get_available_slots`, `book_appointment`, `request_human_callback`, served at `/api/webhooks/voice_agent/{provider}/{workspace}?event=tool`. Retell callbacks are signature-checked (`x-retell-signature`); Bolna callbacks carry the connection's secret token.
- **After the call:** transcript, recording and AI notes as for any call. Answers are saved to the lead, its status moves (Contacted → Qualified → Consult booked, or Lost if not interested) and it gets a 0–100 lead score. Unanswered calls are retried (up to 3 attempts).
- **Calling hours:** calls only go out inside the configured hours (09:00–21:00 at most, per TRAI rules). Everything else is queued and dialled by `/api/cron/dispatch` (every 5 minutes on Vercel; note that Vercel's Hobby plan only allows daily crons).
- With Retell or Bolna, press **Sync agent** after changing settings or the knowledge base. Kicko pushes the prompt, greeting, tools and webhook.

## Calling & AI call notes

Settings → Calling. Each agency connects **Exotel** (India) or **Twilio** (elsewhere), or the **calling sandbox** (no account; scripted conversations through the real webhooks).

- **Click-to-call** (bridge): the provider rings the counsellor's own mobile (set under *Your phone*), then connects the client. No browser softphone is needed.
- **Inbound**: callers are matched to a client or lead by number (unknown numbers become leads, source *Call*) and routed to the owner's phone, or to everyone with a phone set. Missed calls show on the sidebar.
- **Recording** with a consent announcement (configurable). The recording is downloaded into the agency's storage, transcribed (Deepgram, `DEEPGRAM_API_KEY`), then Claude (`ANTHROPIC_API_KEY`) writes notes: summary, sentiment, next steps, suggested tasks and the facts the caller gave (destination, intake, English test…). Staff add the tasks and apply the facts with one click. Without keys, the sandbox uses keyword rules.
- Callback URLs: `https://<app>/api/webhooks/telephony/{provider}/{workspace}?event=…&token=…`. Twilio callbacks are signature-checked (`X-Twilio-Signature`); Exotel doesn't sign callbacks, so each URL carries the connection's secret token. Status callbacks are idempotent and never move a call backwards.
- Call minutes, transcription minutes and AI tokens are metered per agency (Settings → Integrations → Usage).

## AI copilot and AI on every screen

The dashboard's **Copilot** rail gives a daily brief: up to four cards (document the AI check flagged, a chat the WhatsApp assistant handed to a person with no reply yet, expiring documents, overdue money, stalled cases, warm leads with nothing booked), each with one action. Plain code picks and orders the cards (`server/copilot.ts`); the model only words the headline and one line per card (`server/ai/brief.ts`). It's written at most once per day per set of cards (cached, 2 credits); with no model, no credits, or a read-only workspace the same cards come with template wording at no cost.

Other AI surfaces: the sidebar's **AI agents** status (voice agent, WhatsApp assistant, call notes, document checks), **Live now** calls and WhatsApp AI stats on the dashboard, **AI flags** and a document-vs-profile comparison on the case page, and a **context panel** beside each inbox conversation (lead score, open cases, eligibility estimate, details the AI captured).

| | Starter | Growth | Pro / trial |
|---|---|---|---|
| Copilot brief | Owners and admins see a "See Growth" card; staff see nothing | ✓ | ✓ |
| Sidebar AI agents | hidden | WhatsApp, call notes | voice, WhatsApp, call notes, doc check |
| Live now (calls, WhatsApp AI) | Today card only | ✓ | ✓ |
| Case: AI flags + comparison | hidden | hidden | ✓ (unless turned off in Settings → Integrations) |
| Inbox context panel | ✓ (no eligibility) | ✓ | ✓ |

Cards follow the viewer's role like the rest of the dashboard: document and case cards need case access, money cards need billing access, lead cards need lead access. Accounts staff only see money; document officers don't see money or leads. Data an AI captured earlier (notes, lead scores, past checks) stays visible after a downgrade; nothing new runs.

## Daily job

`/api/cron/daily` (Vercel Cron, 08:00 IST via `apps/web/vercel.json`, `Authorization: Bearer $CRON_SECRET`) creates tasks for overdue installments, verified documents expiring within 60 days, and passports expiring within 6 months. Safe to re-run.

## Production (Neon + Vercel)

1. On Neon: `CREATE ROLE kicko_app LOGIN PASSWORD '…' NOBYPASSRLS;`
2. `DATABASE_URL` = kicko_app pooled URL, `DIRECT_URL` = owner URL; run `npm run deploy --workspace @kicko/db`.
3. Set `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` on Vercel.
4. Swap the in-memory rate limiter (`apps/web/src/server/public.ts`) for Upstash when running multiple instances.

## Known follow-ups

- `npm audit`: remaining findings are in the Prisma 6 CLI and Next 15's bundled postcss (build-time only). They're fixed by upgrading to Prisma 7 / Next 16, planned as a separate migration.
- Invite emails are copy-link for now; Resend email delivery arrives with notifications.
- Plain-English commands in the command bar (Ctrl+K / ⌘K) and "Ask copilot" questions are next for the copilot.
