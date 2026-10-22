// Demo agency with realistic sample data. Needs the web app running (accounts
// are created through the real auth endpoint so passwords hash correctly).
//   npm run db:seed:demo   →   sign in at http://localhost:3000 as demo@kicko.app / demo-pass-123

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextRef, Prisma, prisma, withTenant, type Tx } from '../src/index';
import { provisionTenant } from '../src/provision';
import type { Stage } from '../src/visa-catalog';

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const SLUG = 'demo';
const PASSWORD = 'demo-pass-123';

async function account(name: string, email: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing.id;
  // A production build allows 3 sign-ups per 10 seconds; wait and retry when told to.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${APP}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: APP },
      body: JSON.stringify({ name, email, password: PASSWORD }),
    });
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get('x-retry-after') ?? res.headers.get('retry-after') ?? 10);
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Sign-up failed for ${email}: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { user: { id: string } }).user.id;
  }
}

const days = (n: number) => new Date(Date.now() + n * 86400_000);
const at = (dayOffset: number, hour: number, min = 0) => {
  // Wall-clock time in IST.
  const d = new Date(Date.now() + dayOffset * 86400_000);
  const ist = new Date(d.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hour, min) - 330 * 60_000);
};

async function main() {
  // Core data once; Phase 2 data is added to an existing demo workspace if missing.
  const existing = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  const T = existing?.id ?? (await seedCore());
  await seedPhase2(T);
  const portalLink = await seedPhase3(T);
  await seedPhase4(T);
  await seedBranches(T);
  console.log(`Demo workspace ready → ${APP}/${SLUG}\nSign in as demo@kicko.app / ${PASSWORD}`);
  console.log(`Priya's client portal (one-time link, 7 days) → ${portalLink}`);
}

// ── Branches: Head office (Chennai) and Coimbatore, with a counsellor there ──

async function seedBranches(T: string) {
  await withTenant(T, async (tx) => {
    if (await tx.branch.count() > 1) return;
    const hq = await tx.branch.findFirst({ orderBy: { createdAt: 'asc' } });
    if (hq) await tx.branch.update({ where: { id: hq.id }, data: { name: 'Chennai (head office)', city: 'Chennai' } });
    const cbe = await tx.branch.create({ data: { tenantId: T, name: 'Coimbatore', city: 'Coimbatore' } });
    const rahul = await prisma.user.findUnique({ where: { email: 'rahul@kicko.app' } });
    await tx.membership.updateMany({ where: { branchId: null }, data: { branchId: hq?.id ?? null } });
    if (rahul) {
      await tx.membership.updateMany({ where: { userId: rahul.id }, data: { branchId: cbe.id } });
      await tx.lead.updateMany({ where: { ownerId: rahul.id }, data: { branchId: cbe.id } });
      await tx.case.updateMany({ where: { ownerId: rahul.id }, data: { branchId: cbe.id } });
    }
    await tx.lead.updateMany({ where: { branchId: null }, data: { branchId: hq?.id ?? null } });
    await tx.case.updateMany({ where: { branchId: null }, data: { branchId: hq?.id ?? null } });
  });
}

// ── Phase 4: WhatsApp sandbox, templates, automations, conversations ────────

function encrypt(plain: string) {
  // Same format as apps/web/src/server/secrets.ts (v1.iv.tag.data, AES-256-GCM).
  const key = createHash('sha256').update(process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET!).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

const DEMO_TEMPLATES: [string, string, string][] = [
  ['case_update', 'UTILITY', 'Hi {{1}}, your {{3}} application has moved to: {{2}}. You can follow every step in your client portal.'],
  ['document_rejected', 'UTILITY', 'Hi {{1}}, we need a new copy of your {{2}}. Reason: {{3}}. Please upload it in your client portal.'],
  ['invoice_issued', 'UTILITY', 'Hi {{1}}, invoice {{2}} for {{3}} has been issued. You can view and pay it in your client portal.'],
  ['payment_reminder', 'UTILITY', 'Hi {{1}}, a payment of {{2}} was due on {{3}}. Please pay at the earliest, or reply here if you need help.'],
  ['payment_received', 'UTILITY', 'Hi {{1}}, we have received your payment of {{2}}. Receipt number: {{3}}. Thank you!'],
  ['portal_link', 'UTILITY', 'Hi {{1}}, here is your secure link to your client portal: {{2}} It works once and expires soon.'],
  ['enquiry_follow_up', 'MARKETING', 'Hi {{1}}, thanks for your interest in studying or settling abroad. When is a good time for our counsellor to call you?'],
];

async function seedPhase4(T: string) {
  // Same config shape the app's sandbox providers create (secret fields encrypted).
  const existing = await withTenant(T, (tx) => tx.providerConnection.findMany({ where: { tenantId: T } }));
  if (existing.some((c) => c.capability === 'messaging')) return;
  await withTenant(T, async (tx) => {
    await tx.providerConnection.create({
      data: {
        tenantId: T,
        capability: 'messaging',
        provider: 'whatsapp-sandbox',
        config: { appSecret: encrypt(randomBytes(24).toString('base64url')), verifyToken: randomBytes(18).toString('base64url') },
      },
    });
    if (!existing.some((c) => c.capability === 'payments')) {
      await tx.providerConnection.create({
        data: { tenantId: T, capability: 'payments', provider: 'payments-sandbox', config: { webhookSecret: encrypt(randomBytes(24).toString('base64url')) } },
      });
    }
  });
  await withTenant(T, async (tx) => {
    for (const [name, category, body] of DEMO_TEMPLATES) {
      await tx.whatsAppTemplate.create({ data: { tenantId: T, name, category, status: 'APPROVED', body, variables: new Set(body.match(/\{\{\d+\}\}/g)).size } });
    }
    await tx.automation.createMany({
      data: [
        { tenantId: T, trigger: 'CASE_STAGE', templateName: 'case_update' },
        { tenantId: T, trigger: 'DOC_REJECTED', templateName: 'document_rejected' },
        { tenantId: T, trigger: 'PAYMENT_RECEIVED', templateName: 'payment_received' },
      ],
    });

    const wamid = () => `wamid.DEMO${randomBytes(8).toString('hex').toUpperCase()}`;
    const owner = (await tx.membership.findFirstOrThrow({ where: { role: 'COUNSELLOR' } })).userId;

    // Karthik: WhatsApp enquiry (lead), last message unread.
    const karthik = await tx.lead.findFirst({ where: { firstName: 'Karthik' } });
    if (karthik) {
      const convo: [number, 'INBOUND' | 'OUTBOUND', string][] = [
        [-130, 'INBOUND', 'Hi, I want to do my masters in Australia. My IELTS is 7.0. Is the 190 visa possible after studies?'],
        [-122, 'OUTBOUND', "Great score, Karthik. A master's in Australia can lead to the 485 graduate visa, and then 190 depending on your occupation and state. What's your bachelor's degree, and which intake are you aiming for?"],
        [-40, 'INBOUND', "B.E. Computer Science, 2023. 2 years' work at an IT company. Feb 2027 intake. Budget around 25 lakhs. Can someone call me?"],
      ];
      for (const [min, direction, body] of convo) {
        await tx.message.create({
          data: {
            tenantId: T, leadId: karthik.id, channel: 'WHATSAPP', direction, body, externalId: wamid(), phone: karthik.phoneNormalized,
            status: direction === 'INBOUND' ? 'RECEIVED' : 'READ', authorId: direction === 'OUTBOUND' ? owner : null,
            readAt: direction === 'OUTBOUND' || min < -100 ? new Date(Date.now() + (min + 5) * 60_000) : null,
            createdAt: new Date(Date.now() + min * 60_000),
          },
        });
      }
      await tx.lead.update({ where: { id: karthik.id }, data: { waOptIn: true, waOptInAt: new Date(Date.now() - 130 * 60_000), waLastInbound: new Date(Date.now() - 40 * 60_000) } });
    }

    // Arjun (client): payment reminder template, read.
    const arjun = await tx.client.findFirst({ where: { firstName: 'Arjun' } });
    if (arjun) {
      await tx.message.create({
        data: {
          tenantId: T, clientId: arjun.id, channel: 'WHATSAPP', direction: 'OUTBOUND', templateName: 'payment_reminder', status: 'READ',
          body: 'Hi Arjun, a payment of ₹42,480 was due on 10 Oct 2026. Please pay at the earliest, or reply here if you need help.',
          externalId: wamid(), phone: arjun.phoneNormalized, createdAt: days(-2),
        },
      });
      await tx.message.create({
        data: {
          tenantId: T, clientId: arjun.id, channel: 'WHATSAPP', direction: 'INBOUND', status: 'RECEIVED', readAt: days(-1.9),
          body: 'Sorry for the delay, will transfer by Friday.', externalId: wamid(), phone: arjun.phoneNormalized, createdAt: days(-1.95),
        },
      });
      await tx.client.update({ where: { id: arjun.id }, data: { waOptIn: true, waOptInAt: days(-60), waLastInbound: days(-1.95) } });
    }
  });
}

// ── Phase 3: portal messages + a fresh login link for Priya ─────────────────

async function seedPhase3(T: string) {
  return withTenant(T, async (tx) => {
    const priya = await tx.client.findFirstOrThrow({ where: { firstName: 'Priya' } });
    if (!(await tx.message.count({ where: { clientId: priya.id } }))) {
      const owner = priya.ownerId;
      const msgs: [number, 'INBOUND' | 'OUTBOUND', string][] = [
        [-26, 'OUTBOUND', 'Hi Priya, welcome to your portal. You can upload documents and message us here anytime.'],
        [-25, 'INBOUND', 'Thank you! I have uploaded my passport and IELTS.'],
        [-3, 'OUTBOUND', 'Your biometrics appointment is booked at VFS Chennai. Please carry your original passport.'],
        [-0.1, 'INBOUND', 'Seneca says the corrected offer letter will come by Friday. Is that okay for lodging?'],
      ];
      for (const [d, direction, body] of msgs) {
        await tx.message.create({
          data: { tenantId: T, clientId: priya.id, direction, body, authorId: direction === 'OUTBOUND' ? owner : null, createdAt: days(d), readAt: d < -1 ? days(d + 0.1) : null },
        });
      }
    }
    const token = randomBytes(32).toString('base64url');
    await tx.portalToken.create({
      data: { tenantId: T, clientId: priya.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: days(7) },
    });
    await tx.client.update({ where: { id: priya.id }, data: { portalInvitedAt: priya.portalInvitedAt ?? new Date() } });
    return `${APP}/portal/${SLUG}/auth?t=${token}`;
  });
}

async function seedCore() {
  const ownerId = await account('Mugundan', 'demo@kicko.app');
  const divya = await account('Divya Menon', 'divya@kicko.app');
  const rahul = await account('Rahul Kumar', 'rahul@kicko.app');
  const ananya = await account('Ananya Rao', 'ananya@kicko.app');

  const tenant = await provisionTenant({ name: 'Horizon Overseas', slug: SLUG, ownerUserId: ownerId });
  const T = tenant.id;

  await withTenant(T, async (tx) => {
    await tx.membership.createMany({
      data: [
        { tenantId: T, userId: divya, role: 'COUNSELLOR' },
        { tenantId: T, userId: rahul, role: 'COUNSELLOR' },
        { tenantId: T, userId: ananya, role: 'DOC_OFFICER' },
      ],
    });
    const products = Object.fromEntries((await tx.visaProduct.findMany()).map((p) => [p.code, p]));
    const act = (data: Parameters<Tx['activity']['create']>[0]['data']) => tx.activity.create({ data });

    // ── Leads ──
    const leads: [string, string, string, 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONSULT_BOOKED' | 'LOST', 'WEB_FORM' | 'WHATSAPP' | 'CALL' | 'WALK_IN' | 'REFERRAL' | 'ADS', string | null, string | null, string][] = [
      ['Karthik', 'S', '+919845014417', 'QUALIFIED', 'ADS', 'AU_190', divya, 'Masters in Australia, IELTS 7.0, 2 yrs IT experience. Budget ~25L.'],
      ['Meera', 'Nair', '+919812233445', 'NEW', 'WEB_FORM', 'CA_STUDY', null, 'PG diploma in Canada for Jan intake.'],
      ['Arvind', 'Patel', '+919900112233', 'CONTACTED', 'WHATSAPP', 'CA_EE', rahul, 'CRS around 470, wants to improve score.'],
      ['Sana', 'Khan', '+919811122233', 'CONSULT_BOOKED', 'REFERRAL', 'GB_STUDENT', divya, 'MSc Data Science, Sept intake.'],
      ['Joseph', 'Thomas', '+919876001122', 'NEW', 'CALL', 'US_B1B2', null, 'Visiting son in Texas for 3 months.'],
      ['Lakshmi', 'Iyer', '+919845566778', 'CONTACTED', 'WALK_IN', 'CA_SUPER', rahul, 'Super visa for parents.'],
      ['Rohit', 'Verma', '+919812345670', 'NEW', 'ADS', 'DE_BLUECARD', null, 'Mechanical engineer, has German job offer.'],
      ['Nisha', 'Gupta', '+919898989898', 'QUALIFIED', 'WEB_FORM', 'NZ_STUDENT', divya, 'Hospitality diploma in Auckland.'],
      ['Imran', 'Ali', '+919700011122', 'LOST', 'WHATSAPP', 'AU_500', rahul, 'Budget mismatch.'],
    ];
    for (const [i, [firstName, lastName, phone, status, source, code, owner, message]] of leads.entries()) {
      const product = code ? products[code] : null;
      const lead = await tx.lead.create({
        data: {
          tenantId: T, ref: await nextRef(tx, T, 'lead', 'L'), firstName, lastName, phone, phoneNormalized: phone,
          status, source, ownerId: owner, message, productId: product?.id, interestCountry: product?.country,
          interestCategory: product?.category, lostReason: status === 'LOST' ? 'Budget' : null,
          createdAt: days(-i * 1.3),
        },
      });
      await act({ tenantId: T, type: 'LEAD_CREATED', summary: `Lead created from ${source.replace('_', ' ').toLowerCase()}`, leadId: lead.id, createdAt: lead.createdAt });
      if (status === 'CONSULT_BOOKED') {
        await tx.appointment.create({ data: { tenantId: T, title: 'UK study consultation', startsAt: at(0, 16, 30), endsAt: at(0, 17), staffId: owner, leadId: lead.id, mode: 'VIDEO' } });
      }
      if (i === 0) {
        await tx.task.create({ data: { tenantId: T, title: 'Call Karthik back about 190 pathway', dueAt: at(0, 15), assigneeId: ownerId, leadId: lead.id, priority: 1 } });
      }
    }

    // ── Clients with cases ──
    const clients: [string, string, string, string, number, string, Record<string, string>[]][] = [
      ['Priya', 'Raman', '+919840011223', 'CA_STUDY', 8, divya, [{ test: 'IELTS', overall: '7.0', l: '7.5', r: '7.0', w: '6.5', s: '7.0', date: '2026-08-12' }]],
      ['Arjun', 'Mehta', '+919811100022', 'AU_190', 3, rahul, [{ test: 'PTE', overall: '79', l: '82', r: '78', w: '80', s: '76', date: '2025-01-10' }]],
      ['Fatima', 'Sheikh', '+919822233344', 'GB_SPOUSE', 1, ananya, []],
      ['Vikram', 'Iyer', '+919833344455', 'CA_EE', 4, rahul, [{ test: 'CELPIP', overall: '9', l: '9', r: '9', w: '9', s: '9', date: '2026-03-02' }]],
      ['Sneha', 'Pillai', '+919844455566', 'US_B1B2', 2, divya, []],
    ];
    for (const [i, [firstName, lastName, phone, code, stageIdx, owner, tests]] of clients.entries()) {
      const product = products[code]!;
      const stages = product.stages as Stage[];
      const client = await tx.client.create({
        data: {
          tenantId: T, ref: await nextRef(tx, T, 'client', 'C'), firstName, lastName, phone, phoneNormalized: phone,
          email: `${firstName.toLowerCase()}@example.com`, ownerId: owner, nationality: 'Indian', tests,
          passportNumber: `Z${(4810000 + i * 1371).toString()}`,
          passportExpiry: i === 1 ? days(120) : days(1400),
          dob: new Date(Date.UTC(1996 + i, i, 10 + i)),
          createdAt: days(-40 + i * 3),
        },
      });
      const c = await tx.case.create({
        data: {
          tenantId: T, ref: await nextRef(tx, T, `case_${product.country}`, `KCK-${product.country}`), clientId: client.id,
          productId: product.id, stageKey: stages[stageIdx]!.key, ownerId: owner,
          stageSince: days(i === 2 ? -19 : -3 - i), createdAt: days(-38 + i * 3),
          lodgedAt: stages.slice(0, stageIdx + 1).some((s) => /lodged|submitted/.test(s.key)) ? days(-5) : null,
          dates: i === 0 ? { biometrics: at(2, 10, 30).toISOString().slice(0, 10), intake: '2027-01-11' } : {},
        },
      });
      for (let s = 0; s <= stageIdx; s++) {
        await tx.stageHistory.create({ data: { tenantId: T, caseId: c.id, fromKey: s ? stages[s - 1]!.key : null, toKey: stages[s]!.key, byUserId: owner, at: days(-38 + i * 3 + s * 4) } });
        if (s) await act({ tenantId: T, type: 'STAGE_CHANGED', summary: `${stages[s - 1]!.name} → ${stages[s]!.name}`, caseId: c.id, clientId: client.id, actorId: owner, createdAt: days(-38 + i * 3 + s * 4) });
      }
      await act({ tenantId: T, type: 'CASE_OPENED', summary: `Case ${c.ref} opened · ${product.name}`, caseId: c.id, clientId: client.id, actorId: owner, createdAt: c.createdAt });
      if (i === 0) {
        await tx.note.create({ data: { tenantId: T, body: 'Offer letter says "Ramanathan", passport says "Raman". Asked Seneca for a corrected letter.', authorId: divya, caseId: c.id, clientId: client.id } });
        await act({ tenantId: T, type: 'NOTE', summary: 'Offer letter says "Ramanathan", passport says "Raman". Asked Seneca for a corrected letter.', caseId: c.id, clientId: client.id, actorId: divya });
        await tx.task.create({ data: { tenantId: T, title: 'Get corrected offer letter from Seneca', dueAt: at(-1, 12), assigneeId: ownerId, caseId: c.id, clientId: client.id, priority: 1 } });
        await tx.appointment.create({ data: { tenantId: T, title: 'Biometrics prep call', startsAt: at(0, 11), endsAt: at(0, 11, 30), staffId: divya, clientId: client.id, caseId: c.id, mode: 'PHONE' } });
      }
      if (i === 1) await tx.task.create({ data: { tenantId: T, title: 'PTE expires soon: book retest', dueAt: at(0, 18), assigneeId: ownerId, caseId: c.id, clientId: client.id } });
      if (i === 2) {
        await tx.familyMember.create({ data: { tenantId: T, clientId: client.id, relation: 'SPOUSE', name: 'Imran Sheikh', included: false } });
        await tx.task.create({ data: { tenantId: T, title: 'Collect sponsor payslips (6 months)', dueAt: at(2, 12), assigneeId: ananya, caseId: c.id, clientId: client.id } });
      }
    }

    // ── Walk-ins today ──
    await tx.checkIn.createMany({
      data: [
        { tenantId: T, name: 'Deepak Raj', phone: '+919811177788', purpose: 'Study abroad', createdAt: at(0, 10, 5) },
        { tenantId: T, name: 'Kavya Shetty', phone: '+919822288899', purpose: 'Visit visa', createdAt: at(0, 10, 20) },
      ],
    });
  });

  return T;
}

// ── Phase 2: documents, partners, billing ──────────────────────────────────

const STORAGE = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../.storage');

async function storeFile(T: string, label: string) {
  const key = `tenants/${T}/documents/demo-${label}-${randomBytes(4).toString('hex')}.pdf`;
  const file = path.join(STORAGE, key);
  await mkdir(path.dirname(file), { recursive: true });
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 18 Tf 40 150 Td (Sample: ${label.replace(/[()]/g, '')}) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
  await writeFile(file, body);
  return { key, size: Buffer.byteLength(body) };
}

const fy = (d: Date) => {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
};

async function docNo(tx: Tx, T: string, kind: 'invoice' | 'receipt', prefix: string, date: Date) {
  const f = fy(date);
  const row = await tx.counter.upsert({
    where: { tenantId_key: { tenantId: T, key: `${kind}_${f}` } },
    create: { tenantId: T, key: `${kind}_${f}`, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}/${f}/${String(row.value).padStart(4, '0')}`;
}

async function seedPhase2(T: string) {
  if (await withTenant(T, (tx) => tx.institution.count())) return;

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: T } });
  await prisma.tenant.update({
    where: { id: T },
    data: {
      settings: {
        ...(tenant.settings as object),
        billing: {
          legalName: 'Horizon Overseas Education Pvt. Ltd.',
          address: '3rd Floor, 12 Cathedral Road, Gopalapuram, Chennai 600086, Tamil Nadu',
          gstin: '33AAHCH1234K1Z2',
          pan: 'AAHCH1234K',
          invoicePrefix: 'HO',
          defaultTaxMode: 'GST_INTRA',
          upiId: 'horizonoverseas@okhdfcbank',
          bankDetails: 'Horizon Overseas Education Pvt. Ltd. · HDFC Bank · A/c 50200012345678 · IFSC HDFC0000123',
          terms: 'Service fees are non-refundable once the application is lodged. Government, university and third-party fees are payable separately.',
        },
      },
    },
  });

  await withTenant(T, async (tx) => {
    const members = await tx.membership.findMany();
    const owner = members.find((m) => m.role === 'OWNER')!.userId;
    const docOfficer = members.find((m) => m.role === 'DOC_OFFICER')?.userId ?? owner;
    const products = Object.fromEntries((await tx.visaProduct.findMany()).map((p) => [p.code, p]));

    // Packages
    const study = await tx.servicePackage.create({
      data: { tenantId: T, name: 'Study abroad: full service', productId: products.CA_STUDY!.id, price: 5_000_000, plan: [{ label: 'On signing', percent: 50, dueDays: 0 }, { label: 'Visa lodged', percent: 30, dueDays: 30 }, { label: 'Visa decision', percent: 20, dueDays: 60 }] },
    });
    const pr = await tx.servicePackage.create({
      data: { tenantId: T, name: 'Skilled migration (PR)', productId: products.AU_190!.id, price: 12_000_000, plan: [{ label: 'On signing', percent: 40, dueDays: 0 }, { label: 'Invitation received', percent: 30, dueDays: 90 }, { label: 'Visa lodged', percent: 30, dueDays: 150 }] },
    });
    const visit = await tx.servicePackage.create({
      data: { tenantId: T, name: 'Visitor visa', productId: products.US_B1B2!.id, price: 1_200_000, plan: [] },
    });

    // Partners
    const inst = async (name: string, country: string, city: string, currency: string, pct: number, courses: [string, string, number, string][]) => {
      const i = await tx.institution.create({ data: { tenantId: T, name, country, city, currency, commissionValue: pct * 100, agreementUntil: days(country === 'GB' ? 40 : 400) } });
      for (const [cname, level, fee, intakes] of courses) {
        await tx.course.create({ data: { tenantId: T, institutionId: i.id, name: cname, level, tuitionFee: fee * 100, intakes, durationMonths: level === "Master's" ? 12 : 24 } });
      }
      return tx.institution.findUniqueOrThrow({ where: { id: i.id }, include: { courses: true } });
    };
    const seneca = await inst('Seneca Polytechnic', 'CA', 'Toronto', 'CAD', 15, [['PG Diploma Data Analytics', 'PG Diploma', 18_950, 'Jan, May, Sep'], ['PG Diploma Cybersecurity', 'PG Diploma', 19_400, 'Jan, Sep']]);
    await inst('Humber Polytechnic', 'CA', 'Toronto', 'CAD', 15, [['Project Management (Grad Cert)', 'PG Diploma', 18_100, 'Jan, May, Sep']]);
    await inst('University of Leeds', 'GB', 'Leeds', 'GBP', 10, [['MSc Data Science', "Master's", 31_750, 'Sep']]);
    await inst('Deakin University', 'AU', 'Melbourne', 'AUD', 15, [['Master of Information Technology', "Master's", 39_800, 'Mar, Jul, Nov']]);

    // Cases by client
    const cases = await tx.case.findMany({ include: { client: true, product: true } });
    const byName = (first: string) => cases.find((c) => c.client.firstName === first)!;

    // Documents: sync checklists, then give Priya a realistic mix.
    for (const c of cases) {
      const checklist = c.product.checklist as { key: string; name: string; group: string; required: boolean }[];
      await tx.document.createMany({
        data: checklist.map((it, i) => ({ tenantId: T, caseId: c.id, clientId: c.clientId, checklistKey: it.key, name: it.name, group: it.group, required: it.required, sortOrder: i })),
        skipDuplicates: true,
      });
    }
    const priya = byName('Priya');
    const setDoc = async (caseId: string, nameStart: string, status: 'VERIFIED' | 'UPLOADED' | 'REJECTED', extra: { expiresAt?: Date; rejectionReason?: string } = {}, aiCheck?: Prisma.InputJsonValue) => {
      const doc = await tx.document.findFirst({ where: { caseId, name: { startsWith: nameStart } } });
      if (!doc) return;
      const f = await storeFile(T, doc.name.replace(/\W+/g, '-').toLowerCase());
      await tx.documentFile.create({ data: { tenantId: T, documentId: doc.id, storageKey: f.key, fileName: `${doc.name.replace(/[^\w ]+/g, '').trim()}.pdf`, contentType: 'application/pdf', size: f.size, uploadedBy: owner, ...(aiCheck ? { aiStatus: 'done', aiCheck } : {}) } });
      await tx.document.update({ where: { id: doc.id }, data: { status, ...extra, ...(status === 'VERIFIED' ? { verifiedBy: docOfficer, verifiedAt: days(-5) } : {}) } });
    };
    await setDoc(priya.id, 'Passport', 'VERIFIED', { expiresAt: new Date('2031-03-14') });
    await setDoc(priya.id, '10th', 'VERIFIED');
    await setDoc(priya.id, 'Degree', 'VERIFIED');
    await setDoc(priya.id, 'English', 'VERIFIED', { expiresAt: days(45) });
    // The AI document check caught the surname mismatch (shows on the case, the dashboard brief and the review).
    await setDoc(priya.id, 'Letter of acceptance', 'UPLOADED', {}, {
      model: 'demo',
      sandbox: false,
      checkedAt: days(-2).toISOString(),
      documentType: 'Offer letter, Seneca Polytechnic',
      matchesExpected: 'yes',
      legible: true,
      fields: { fullName: 'Priya Ramanathan', dateOfBirth: null, documentNumber: null, issueDate: null, expiryDate: null, issuingCountry: 'Canada' },
      issues: [{ severity: 'high', message: 'Surname does not match the passport: "Ramanathan" here, "Raman" on the passport. Ask the college for a corrected letter.' }],
    });
    await setDoc(priya.id, 'GIC', 'UPLOADED');
    await setDoc(priya.id, 'Bank statements', 'REJECTED', { rejectionReason: 'Statements must cover the last 6 months' });
    const arjun = byName('Arjun');
    await setDoc(arjun.id, 'Passport', 'VERIFIED', { expiresAt: days(120) });
    await setDoc(arjun.id, 'Skills assessment', 'UPLOADED');

    // Priya's Seneca application, enrolled → commission claim
    const course = seneca.courses.find((c) => c.name.startsWith('PG Diploma Data'))!;
    const app = await tx.application.create({
      data: { tenantId: T, caseId: priya.id, institutionId: seneca.id, courseId: course.id, intake: 'Jan 2027', status: 'ENROLLED', tuitionFee: course.tuitionFee, currency: 'CAD', studentId: '184220917', submittedAt: days(-35), decisionAt: days(-28) },
    });
    await tx.commissionClaim.create({
      data: { tenantId: T, applicationId: app.id, institutionId: seneca.id, amount: Math.round((course.tuitionFee! * 1500) / 10_000), currency: 'CAD', dueDate: days(55) },
    });

    // Invoices
    const invoice = async (c: (typeof cases)[number], pkg: typeof study, issued: Date, payments: { amount: number; method: 'UPI' | 'BANK_TRANSFER' | 'CASH'; ago: number; ref: string }[]) => {
      const tax = Math.round((pkg.price * 1800) / 10_000);
      const total = pkg.price + tax;
      const plan = (pkg.plan as { label: string; percent: number; dueDays: number }[]).length ? (pkg.plan as { label: string; percent: number; dueDays: number }[]) : [{ label: 'Full payment', percent: 100, dueDays: 0 }];
      let allocated = 0;
      const inst = plan.map((s, i) => {
        const amount = i === plan.length - 1 ? total - allocated : Math.round((total * s.percent) / 100);
        allocated += amount;
        return { label: s.label, amount, dueDate: new Date(issued.getTime() + s.dueDays * 86400_000), sortOrder: i };
      });
      const paid = payments.reduce((a, p) => a + p.amount, 0);
      let left = paid;
      const inv = await tx.invoice.create({
        data: {
          tenantId: T, ref: await docNo(tx, T, 'invoice', 'HO', issued), clientId: c.clientId, caseId: c.id, status: paid >= total ? 'PAID' : paid ? 'PARTIALLY_PAID' : 'ISSUED',
          taxMode: 'GST_INTRA', issueDate: issued, subtotal: pkg.price, taxTotal: tax, total, amountPaid: paid, createdBy: owner,
          items: { create: [{ tenantId: T, description: pkg.name, unitPrice: pkg.price, amount: pkg.price }] },
          installments: {
            create: inst.map((s) => {
              const p = Math.min(s.amount, left);
              left -= p;
              return { tenantId: T, ...s, paidAmount: p, paidAt: p >= s.amount ? days(-payments[0]!.ago) : null };
            }),
          },
        },
      });
      for (const p of payments) {
        const paidAt = days(-p.ago);
        await tx.payment.create({ data: { tenantId: T, invoiceId: inv.id, clientId: c.clientId, amount: p.amount, method: p.method, reference: p.ref, paidAt, receiptRef: await docNo(tx, T, 'receipt', 'RCPT', paidAt), recordedBy: owner } });
      }
    };
    await invoice(priya, study, days(-40), [{ amount: 2_950_000, method: 'UPI', ago: 39, ref: 'UPI 426183920114' }, { amount: 1_770_000, method: 'BANK_TRANSFER', ago: 8, ref: 'UTR HDFCN52026101812' }]);
    await invoice(arjun, pr, days(-100), [{ amount: 5_664_000, method: 'BANK_TRANSFER', ago: 98, ref: 'UTR SBIN0026071045' }]);
    await invoice(byName('Sneha'), visit, days(-20), []);
    await invoice(byName('Vikram'), { ...pr, name: 'Express Entry: full service', price: 9_500_000, plan: [{ label: 'On signing', percent: 50, dueDays: 0 }, { label: 'ITA received', percent: 50, dueDays: 45 }] } as typeof pr, days(-60), [{ amount: 5_605_000, method: 'UPI', ago: 59, ref: 'UPI 552781049920' }]);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
