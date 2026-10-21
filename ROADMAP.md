# Kicko roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Workspaces, team & roles, leads, clients, cases, tasks, calendar, walk-in kiosk, web form | Done |
| 2 | Documents, GST invoices & payments, Razorpay, partners & commissions, reminders | Done |
| 3 | Client portal, staff inbox | Done |
| 4 | WhatsApp (Cloud API): shared inbox, templates, 24-hour window, automations, opt-in, sandbox + simulator | Done (live Meta test pending) |
| 4.5 | Integration foundation: pluggable providers for every external service (see below) | Done |
| 5a | Calling foundation: LLM/STT/telephony ports, Claude, Deepgram, Exotel, Twilio + sandboxes; click-to-call bridge, inbound routing, recordings, AI call notes (summary, tasks, fields), calls pages, call HUD | Done (live provider test pending) |
| 5b | AI WhatsApp assistant: answers FAQs from a per-agency knowledge base, looks up the lead or case, captures details, books appointments, hands off to a human | Done (sandbox; real AI needs ANTHROPIC_API_KEY) |
| 5c | AI voice agent (Bolna for India, Retell overseas, sandbox): outbound qualification calls, inbound receptionist, CRM tool calls | Done (sandbox; live provider test pending) |
| 5d | Eligibility (CRS, AU points: deterministic, AI explains) and AI document checks (type, expiry, name mismatch) | Done (sandbox; real document reading needs ANTHROPIC_API_KEY) |
| 6a | Sub-agent network: partner portal (refer clients, track progress, commission), automatic commission (% of payments ex-GST or fixed fee), payouts | Done |
| 6b | Government form auto-fill: copy-ready answer sheets for official forms from the client profile, missing answers requested from the client | Done |
| 7a | Plans & billing: Starter / Growth / Pro, 14-day trial, seats, AI credits, Razorpay Subscriptions (sandbox until Kicko's account), GST invoices, lapse → read-only → suspended | Done |
| 7b | Super-admin console at /admin: all agencies with plan, trial, seats, usage, MRR, last activity; extend trial, founding discount (20 slots), manual plan, AI credits, suspend / reactivate, notes; every change logged | Done |
| 7c | CSV / Excel import | Planned |
| 7d | Custom fields & reports | Planned |
| 7e | Trust: 2FA, audit log, data export, backups, legal pages | Planned |
| 7f | Website, pricing page, onboarding | Planned |

## Phase 4.5: Integration foundation

Every external service sits behind an interface (a "port") with swappable adapters, so providers can be added or changed per agency without touching features.

| Capability | Adapters now | Later | Account owner |
|---|---|---|---|
| Storage | Local, S3/R2 | GCS | Platform |
| Email | Resend, Sandbox | SES, SMTP | Platform (agency domain later) |
| Payments | Razorpay, Sandbox | Stripe, Cashfree, PayU | Agency |
| Messaging | WhatsApp Cloud API, WhatsApp Sandbox | SMS, WhatsApp BSPs | Agency |
| LLM / STT / TTS / Telephony / Voice agent | (Phase 5) | Claude, Sarvam, Deepgram, ElevenLabs, Exotel, Plivo, Twilio, Bolna, Retell | Platform / Agency |

Rules:
1. Features call interfaces only, never vendor SDKs.
2. Every capability has a Sandbox adapter (dev, demos, tests).
3. Adapters declare capability flags; the UI adapts. No lowest common denominator.
4. One `ProviderConnection` table per agency and capability: credentials encrypted per field, plus status and health check. Settings → Integrations is generated from adapter descriptors.
5. One webhook pattern: `/api/webhooks/{capability}/{provider}/{workspace}`. Adapters verify signatures and emit normalised events.
6. A wrapper meters usage and cost per agency for every call (feeds Phase 7 billing). Routing and fallback come in Phase 5.

## Phase 7: Ready to sell

Everything needed before other consultancies can be charged for Kicko.

### 7.1 Subscription billing (charging agencies)
- Plans (e.g. Starter / Growth / Pro), monthly & yearly, free trial, per-seat pricing
- Usage metering for costly add-ons: WhatsApp conversations, AI call minutes, storage
- Razorpay Subscriptions (India) and Stripe (overseas agencies); GST invoices to agencies
- Dunning: payment-failed emails, grace period, read-only mode, reactivation

### 7.2 Super-admin console (for the Kicko team)
- All workspaces: plan, seats, usage, MRR, last activity, health
- Suspend / unsuspend, extend trial, discounts, manual plans, credits, admin log (done in 7b)
- Access: SUPER_ADMIN_EMAILS + one-time `npm run admin:grant -- <email>`; anyone else gets a 404
- Later: support access with the agency's consent (with 7e audit log & 2FA), announcements, feature flags per workspace

### 7.3 Data import (switching from Excel / Zoho / other CRMs)
- CSV/XLSX import for leads, clients, cases, payments with column mapping & preview
- Duplicate handling, dry run, undo of an import batch
- Bulk document upload (zip → match to clients)

### 7.4 Flexibility
- Custom fields on leads, clients and cases (text, number, date, select)
- Custom lead stages and sources; branches/locations
- Reports: conversion by source/counsellor, revenue by product, turnaround times, CSV export
- Public REST API + outgoing webhooks for agencies' own tools

### 7.5 Trust, security & legal
- Two-factor login (TOTP) for staff, optional enforcement per workspace; Google sign-in
- Audit log: who viewed/changed/exported what
- Full data export per workspace; account deletion with retention rules (DPDP Act 2023 / GDPR)
- Encrypted backups with tested restore; data hosted in India/Singapore region
- Privacy policy, terms of service, data processing agreement (needs a lawyer)
- External penetration test before launch

### 7.6 Business setup (outside the code)
- Company & GST registration (SaaS = 18% GST), trademark check for "Kicko"
- Support channel & help centre, onboarding videos, status page
- Pilot: 2–3 friendly agencies free/discounted for 2–3 months, then paid launch

## Go-to-market notes
- Position as **the visa-native CRM** (stages, checklists, commissions, portal ready on day one), not a general CRM like Zoho.
- Lead the demo with WhatsApp + the client portal; Indian agencies feel those immediately.
- Price per staff user per month; WhatsApp and AI usage as metered add-ons so heavy usage stays profitable.
