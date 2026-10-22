import { createDecipheriv, createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';
import { testMobile, verifyMobile } from './helpers';

// Phase 4: WhatsApp in sandbox mode. No Meta account: outbound calls are recorded,
// inbound arrives as real signed Meta-format webhooks (simulator + direct posts).

const run = Date.now().toString(36);
const slug = `p4-${run}`;
const DB = 'postgresql://postgres:postgres@localhost:5433/kicko';
const phone = `+9198${String(Date.now()).slice(-8)}`;

// Read the app secret the way the server stores it (AES-GCM with ENCRYPTION_KEY).
function decrypt(blob: string) {
  const env = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
  const raw = env.match(/^ENCRYPTION_KEY="?([^"\n]+)"?/m)?.[1] ?? env.match(/^BETTER_AUTH_SECRET="?([^"\n]+)"?/m)![1]!;
  const [, iv, tag, data] = blob.split('.');
  const d = createDecipheriv('aes-256-gcm', createHash('sha256').update(raw).digest(), Buffer.from(iv!, 'base64url'));
  d.setAuthTag(Buffer.from(tag!, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data!, 'base64url')), d.final()]).toString();
}

async function waSettings() {
  const db = new Pg(DB);
  await db.connect();
  const { rows } = await db.query(
    `SELECT t.id, c.config FROM "Tenant" t JOIN "ProviderConnection" c ON c."tenantId" = t.id AND c.capability = 'messaging' WHERE t.slug = $1`,
    [slug],
  );
  await db.end();
  const cfg = rows[0].config as { appSecret: string; verifyToken: string };
  return { tenantId: rows[0].id as string, wa: { appSecretEnc: cfg.appSecret, verifyToken: cfg.verifyToken, phoneNumberId: '100000000000001' } };
}

test.describe.serial('Phase 4 · WhatsApp (sandbox)', () => {
  let page: Page;
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
    });
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Owner Four');
    await page.getByLabel('Work email').fill(`p4-${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await page.getByLabel('Confirm password').fill('kicko-pass-123');
    await page.getByLabel('Mobile number').fill(testMobile());
    await page.getByLabel('Agency name').fill(`WA Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await verifyMobile(page);
    await page.waitForURL(`**/${slug}`);
  });

  test('connect a sandbox number; approved templates appear', async () => {
    await page.goto(`/${slug}/settings?tab=whatsapp`);
    await page.getByRole('button', { name: 'Try it in sandbox' }).click();
    await expect(page.getByText('Sandbox', { exact: true })).toBeVisible();
    await expect(page.locator('span.font-mono', { hasText: 'case_update' })).toBeVisible();
    await expect(page.getByLabel('Webhook URL')).toHaveValue(new RegExp(`/api/webhooks/messaging/whatsapp-sandbox/${slug}$`));
  });

  test('Meta webhook handshake and signature checks', async ({ request }) => {
    const { wa } = await waSettings();
    const ok = await request.get(`/api/webhooks/messaging/whatsapp-sandbox/${slug}?hub.mode=subscribe&hub.verify_token=${wa.verifyToken}&hub.challenge=12345`);
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toBe('12345');
    expect((await request.get(`/api/webhooks/messaging/whatsapp-sandbox/${slug}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status()).toBe(403);
    const unsigned = await request.post(`/api/webhooks/messaging/whatsapp-sandbox/${slug}`, { data: { object: 'whatsapp_business_account', entry: [] } });
    expect(unsigned.status()).toBe(401);
  });

  test('a new WhatsApp number becomes a lead and lands in the inbox', async () => {
    await page.getByLabel('Customer phone').fill(phone);
    await page.getByLabel('WhatsApp profile name').fill('Karthik S');
    await page.getByLabel('Message').fill('Hi, I want to study in Canada. IELTS 7.0');
    await page.getByRole('button', { name: 'Send as customer' }).click();
    await expect(page.getByText('Delivered to your webhook')).toBeVisible();

    await page.goto(`/${slug}/inbox`);
    const thread = page.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: /Karthik S/ });
    await expect(thread).toContainText('LEAD');
    await expect(page.getByText('Hi, I want to study in Canada. IELTS 7.0').first()).toBeVisible();
    await expect(page.getByText(/24-hour window open until/)).toBeVisible();

    await page.goto(`/${slug}/leads?view=table&source=WHATSAPP`);
    await expect(page.getByRole('link', { name: 'Karthik S' })).toBeVisible();
  });

  test('reply inside the 24-hour window, with delivery ticks', async () => {
    await page.goto(`/${slug}/inbox`);
    await page.getByPlaceholder(/WhatsApp Karthik/).fill('Great score, Karthik! Which intake are you aiming for?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const bubble = page.locator('li', { hasText: 'Great score, Karthik!' });
    await expect(bubble.getByTitle('Sent')).toBeVisible();
    await bubble.getByRole('button', { name: 'read' }).click();
    await expect(page.locator('li', { hasText: 'Great score, Karthik!' }).getByTitle('Read')).toBeVisible();
  });

  test('replayed webhooks are processed once', async ({ request }) => {
    const { wa } = await waSettings();
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '91', phone_number_id: wa.phoneNumberId },
        contacts: [{ profile: { name: 'Karthik S' }, wa_id: phone.slice(1) }],
        messages: [{ from: phone.slice(1), id: `wamid.REPLAY${run}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: `Replay test ${run}` } }],
      } }] }],
    });
    const sig = `sha256=${createHmac('sha256', decrypt(wa.appSecretEnc)).update(body).digest('hex')}`;
    for (let i = 0; i < 3; i++) {
      const r = await request.post(`/api/webhooks/messaging/whatsapp-sandbox/${slug}`, { data: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });
      expect(r.status()).toBe(200);
    }
    const db = new Pg(DB);
    await db.connect();
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM "Message" WHERE body = $1`, [`Replay test ${run}`]);
    await db.end();
    expect(rows[0].n).toBe(1);
  });

  test('converting the lead keeps the conversation; attachments save into documents', async () => {
    // Customer sends a document on WhatsApp.
    await page.goto(`/${slug}/settings?tab=whatsapp`);
    await page.getByLabel('Customer phone').fill(phone);
    await page.getByLabel('Message').fill('Here is my passport');
    await page.getByLabel(/Attach a file/).setInputFiles({ name: 'passport.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
    await page.getByRole('button', { name: 'Send as customer' }).click();
    await expect(page.getByText('Delivered to your webhook')).toBeVisible();

    await page.goto(`/${slug}/leads?view=table&source=WHATSAPP`);
    await page.getByRole('link', { name: 'Karthik S' }).click();
    await expect(page.getByText('Here is my passport')).toBeVisible(); // lead page conversation
    await page.getByRole('button', { name: 'Convert to client →' }).click();
    await page.getByRole('dialog').getByLabel('Open a case for').selectOption({ label: 'Canada · Study Permit' });
    await page.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
    await page.waitForURL(/\/cases\//);
    const caseUrl = page.url();

    await page.goto(`/${slug}/inbox`);
    const thread = page.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: /Karthik S/ });
    await expect(thread).not.toContainText('LEAD'); // now a client thread
    await expect(page.getByText('Great score, Karthik! Which intake are you aiming for?', { exact: true })).toBeVisible(); // history moved over
    const media = page.locator('li', { hasText: 'Here is my passport' });
    const target = await media.getByLabel('Save to document', { exact: true }).locator('option', { hasText: 'Passport (all pages)' }).getAttribute('value');
    await media.getByLabel('Save to document', { exact: true }).selectOption(target!);
    await media.getByRole('button', { name: 'Save' }).click();
    await expect(media.getByText('Saved · to review')).toBeVisible();

    await page.goto(caseUrl);
    await expect(page.getByText('1 to review')).toBeVisible();
  });

  test('automation: moving the case stage sends the case_update template', async () => {
    await page.goto(`/${slug}/settings?tab=whatsapp`);
    await page.getByLabel('When', { exact: true }).selectOption('CASE_STAGE');
    await page.getByLabel('Send template', { exact: true }).selectOption({ label: 'case_update' });
    await page.getByRole('button', { name: 'Add automation' }).click();
    await expect(page.getByText('Case moves to a stage → case_update')).toBeVisible();

    await page.goto(`/${slug}/cases`);
    await page.getByRole('link', { name: 'Karthik S' }).click();
    await page.getByRole('button', { name: /Advance to Applications/ }).click();
    await expect(page.getByText('Stage 2 of 11')).toBeVisible();

    await page.goto(`/${slug}/inbox`);
    await expect(page.getByText('Template · case_update')).toBeVisible();
    await expect(page.getByLabel(/Conversation with/).getByText(/your Study Permit application has moved to: Applications/)).toBeVisible();
  });

  test('after 24 hours only templates can be sent', async () => {
    const db = new Pg(DB);
    await db.connect();
    await db.query(`UPDATE "Client" SET "waLastInbound" = (now() AT TIME ZONE 'UTC') - interval '25 hours' WHERE "phoneNormalized" = $1`, [phone]);
    await db.end();
    await page.goto(`/${slug}/inbox`);
    await expect(page.getByText(/24-hour window closed/)).toBeVisible();
    await expect(page.getByPlaceholder(/WhatsApp Karthik/)).toHaveCount(0);
    await page.getByLabel('Template', { exact: true }).selectOption({ label: 'enquiry_follow_up (marketing)' });
    await expect(page.getByText(/When is a good time for our counsellor to call you\?/).last()).toBeVisible(); // preview
    await page.getByRole('button', { name: 'Send template' }).click();
    await expect(page.getByText('Template · enquiry_follow_up')).toBeVisible();
  });

  test('clients can get a portal link on WhatsApp', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`/portal/${slug}/login`);
    await p.getByRole('tab', { name: 'WhatsApp' }).click();
    await p.getByLabel('Mobile number (WhatsApp)').fill(phone);
    await p.getByRole('button', { name: 'Send me a link on WhatsApp' }).click();
    await expect(p.getByText('Check WhatsApp.')).toBeVisible();
    await p.getByRole('link', { name: /Development only/ }).click();
    await p.getByRole('button', { name: 'Open my portal' }).click();
    await expect(p.getByRole('heading', { level: 1 })).toContainText('Karthik');
    await ctx.close();

    await page.goto(`/${slug}/inbox`);
    await expect(page.getByText('Template · portal_link')).toBeVisible();
  });

  test('no browser console errors across the WhatsApp screens', () => {
    expect(consoleErrors).toEqual([]);
  });
});
