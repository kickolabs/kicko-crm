import { createDecipheriv, createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';

// Phase 5b: WhatsApp AI assistant (sandbox: keyword rules + the agency's knowledge base).
// Customers write via real signed webhooks; we check replies, bookings, captured
// details, handoff to a human, staff take-over, and STOP.

const run = Date.now().toString(36);
const slug = `p5b-${run}`;
const DB = 'postgresql://postgres:postgres@localhost:5433/kicko';
const phone = `+9197${String(Date.now()).slice(-8)}`;

function decrypt(blob: string) {
  const env = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
  const raw = env.match(/^ENCRYPTION_KEY="?([^"\n]+)"?/m)?.[1] ?? env.match(/^BETTER_AUTH_SECRET="?([^"\n]+)"?/m)![1]!;
  const [, iv, tag, data] = blob.split('.');
  const d = createDecipheriv('aes-256-gcm', createHash('sha256').update(raw).digest(), Buffer.from(iv!, 'base64url'));
  d.setAuthTag(Buffer.from(tag!, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data!, 'base64url')), d.final()]).toString();
}

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const db = new Pg(DB);
  await db.connect();
  try {
    return (await db.query(sql, params)).rows as T[];
  } finally {
    await db.end();
  }
}

let n = 0;
async function customerSays(request: APIRequestContext, text: string) {
  const [{ config }] = await q<{ config: { appSecret: string } }>(
    `SELECT c.config FROM "ProviderConnection" c JOIN "Tenant" t ON t.id = c."tenantId" WHERE t.slug = $1 AND c.capability = 'messaging'`,
    [slug],
  );
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: '1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '91', phone_number_id: '100000000000001' },
      contacts: [{ profile: { name: 'WhatsApp contact' }, wa_id: phone.slice(1) }],
      messages: [{ from: phone.slice(1), id: `wamid.AI${run}${n++}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
    } }] }],
  });
  const sig = `sha256=${createHmac('sha256', decrypt(config.appSecret)).update(body).digest('hex')}`;
  const r = await request.post(`/api/webhooks/messaging/whatsapp-sandbox/${slug}`, { data: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });
  expect(r.status()).toBe(200);
}

const aiReplies = () =>
  q<{ body: string }>(
    `SELECT m.body FROM "Message" m JOIN "Tenant" t ON t.id = m."tenantId" WHERE t.slug = $1 AND m."aiGenerated" ORDER BY m."createdAt"`,
    [slug],
  ).then((r) => r.map((x) => x.body));

/** Wait for the assistant's next reply (debounced ~1.5s) and return it. */
async function nextReply(before: number) {
  await expect.poll(async () => (await aiReplies()).length, { timeout: 15_000 }).toBeGreaterThan(before);
  return (await aiReplies()).at(-1)!;
}

test.describe.serial('Phase 5b · WhatsApp AI assistant (sandbox)', () => {
  let page: Page;
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
    });
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Meera Owner');
    await page.getByLabel('Work email').fill(`p5b-${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await page.getByLabel('Confirm password').fill('kicko-pass-123');
    await page.getByLabel('Agency name').fill(`Bot Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await page.waitForURL(`**/${slug}`);
    await page.goto(`/${slug}/settings?tab=whatsapp`);
    await page.getByRole('button', { name: 'Try it in sandbox' }).click();
    await expect(page.getByText('Sandbox', { exact: true })).toBeVisible();
  });

  test('set up: turn on, starter answers, own answer, try it', async () => {
    await page.goto(`/${slug}/settings?tab=assistant`);
    await page.getByText('Always on').click();
    await page.getByLabel('Assistant name').fill('Asha');
    await page.getByRole('button', { name: 'Save assistant' }).click();
    await expect(page.getByText('Assistant settings saved.')).toBeVisible();

    await page.getByRole('button', { name: 'Add starter answers' }).click();
    await expect(page.getByText('Can you guarantee my visa?')).toBeVisible();
    await page.getByRole('button', { name: '+ Answer' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Question').fill('Do you offer IELTS coaching?');
    await d.getByLabel('Answer').fill('Yes! We run weekend IELTS coaching batches at our office, starting every month.');
    await d.getByRole('button', { name: 'Save answer' }).click();
    await expect(page.getByText('Do you offer IELTS coaching?')).toBeVisible();

    await page.getByLabel('Test message').fill('do you have ielts coaching?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Test conversation' })).toContainText('weekend IELTS coaching batches');
  });

  test('greets a new customer, saves what they share', async ({ request }) => {
    await customerSays(request, 'Hi');
    expect(await nextReply(0)).toMatch(/I'm Asha, Bot Agency .*'s virtual assistant\. May I know your name/);

    await customerSays(request, 'My name is Ravi Kumar, I want to do my masters in Canada. ravi.k@example.com');
    await nextReply(1);
    const [lead] = await q(`SELECT l."firstName", l."lastName", l.email, l."interestCountry", l."interestCategory" FROM "Lead" l WHERE l."phoneNormalized" = $1`, [phone]);
    expect(lead).toEqual({ firstName: 'Ravi', lastName: 'Kumar', email: 'ravi.k@example.com', interestCountry: 'CA', interestCategory: 'STUDY' });
  });

  test('answers from the knowledge base and books a consultation', async ({ request }) => {
    await customerSays(request, 'Can you guarantee my visa?');
    expect(await nextReply(2)).toContain('No one can guarantee a visa');

    await customerSays(request, 'I would like to book a consultation');
    const offer = await nextReply(3);
    expect(offer).toMatch(/1\. .+\n2\. .+/);
    const second = offer.match(/2\. (.+)/)![1]!;

    await customerSays(request, '2 video');
    expect(await nextReply(4)).toContain(`Booked: ${second}`);
    const appts = await q(`SELECT a.mode, a.title FROM "Appointment" a JOIN "Lead" l ON l.id = a."leadId" WHERE l."phoneNormalized" = $1`, [phone]);
    expect(appts).toEqual([{ mode: 'VIDEO', title: 'Consultation (booked online)' }]);
  });

  test('inbox shows AI replies; asking for a person hands off with a task', async ({ request }) => {
    await customerSays(request, 'Can I speak to a counsellor please');
    expect(await nextReply(5)).toContain('ask a counsellor');
    const tasks = await q(`SELECT t.title, t.priority FROM "Task" t JOIN "Lead" l ON l.id = t."leadId" WHERE l."phoneNormalized" = $1`, [phone]);
    expect(tasks).toEqual([{ title: 'Reply on WhatsApp: Ravi Kumar (Customer asked for a person)', priority: 1 }]);

    // Handed off: the assistant stays quiet.
    await customerSays(request, 'hello?');
    await page.waitForTimeout(2500);
    expect(await aiReplies()).toHaveLength(6);

    await page.goto(`/${slug}/inbox`);
    await page.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: /Ravi Kumar/ }).click();
    await expect(page.getByText('AI reply').first()).toBeVisible();
    await expect(page.getByText('Asha · AI assistant').first()).toBeVisible();
    await expect(page.getByText('Handed to a human')).toBeVisible();
    await page.getByRole('button', { name: 'Resume AI' }).click();
    await expect(page.getByText(/Asha.*\(AI\) is answering this chat/)).toBeVisible();
  });

  test('a staff reply pauses the assistant; STOP opts out', async ({ request }) => {
    await page.getByPlaceholder(/WhatsApp Ravi/).fill('Hi Ravi, Meera here. I will call you in 10 minutes.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('li', { hasText: 'Meera here' }).getByTitle('Sent')).toBeVisible();

    await customerSays(request, 'ok thanks');
    await page.waitForTimeout(2500);
    expect(await aiReplies()).toHaveLength(6);

    // The pause is visible, and can be lifted right away.
    await page.reload();
    await expect(page.getByText('Asha (AI) is paused')).toBeVisible();
    await expect(page.getByText(/A team member replied, so it stays quiet until/)).toBeVisible();
    await page.getByRole('button', { name: 'Resume AI now' }).click();
    await expect(page.getByText('Asha (AI) is answering this chat')).toBeVisible();
    await customerSays(request, 'what are your office hours?');
    expect(await nextReply(6)).toContain("We're open");

    // The simulator tells testers whether the assistant will answer.
    await page.goto(`/${slug}/settings?tab=whatsapp`);
    await page.getByLabel('Customer phone').fill(phone);
    await page.getByLabel('Message').fill('hello again');
    await page.getByRole('button', { name: 'Send as customer' }).click();
    await expect(page.getByText('Asha (AI) will reply in a moment.')).toBeVisible();
    await nextReply(7);

    await customerSays(request, 'STOP');
    await expect.poll(async () => (await q(`SELECT "waOptIn" FROM "Lead" WHERE "phoneNormalized" = $1`, [phone]))[0]!.waOptIn).toBe(false);
  });

  test('no browser console errors', async () => {
    expect(consoleErrors).toEqual([]);
  });
});
