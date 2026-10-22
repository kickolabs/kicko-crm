import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';
import { testMobile, verifyMobile } from './helpers';

// Phase 5a: calling in sandbox mode. Click-to-call → live HUD → recording →
// transcript → AI call notes (keyword fallback, no API key) → tasks & fields;
// inbound calls via the simulator and via raw webhooks (routing, missed calls).

const run = Date.now().toString(36);
const slug = `p5-${run}`;
const DB = 'postgresql://postgres:postgres@localhost:5433/kicko';

async function webhookToken() {
  const db = new Pg(DB);
  await db.connect();
  const { rows } = await db.query(
    `SELECT c.config FROM "ProviderConnection" c JOIN "Tenant" t ON t.id = c."tenantId" WHERE t.slug = $1 AND c.capability = 'telephony'`,
    [slug],
  );
  await db.end();
  return (rows[0].config as { webhookToken: string }).webhookToken;
}

/** Reload until the locator shows up (AI notes are written in the background). */
async function eventually(page: Page, text: string | RegExp) {
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

test.describe.serial('Phase 5 · calling (sandbox)', () => {
  let page: Page;
  let leadUrl = '';
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
    });
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Divya Caller');
    await page.getByLabel('Work email').fill(`p5-${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await page.getByLabel('Confirm password').fill('kicko-pass-123');
    await page.getByLabel('Mobile number').fill(testMobile());
    await page.getByLabel('Agency name').fill(`Call Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await verifyMobile(page);
    await page.waitForURL(`**/${slug}`);
  });

  test('without a provider, the call button points to setup', async () => {
    await page.goto(`/${slug}/leads?new=1`);
    const d = page.getByRole('dialog');
    await d.getByLabel('First name').fill('Priya');
    await d.getByLabel('Last name').fill('Raman');
    await d.getByLabel('Phone / WhatsApp').fill('9840011223');
    await d.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/leads\/[a-z0-9]+$/);
    leadUrl = page.url();
    await expect(page.getByRole('link', { name: 'Set up calling' })).toHaveAttribute('href', `/${slug}/settings?tab=calling`);
  });

  test('connect the calling sandbox', async () => {
    await page.goto(`/${slug}/settings?tab=calling`);
    await page.getByRole('button', { name: 'Try calling in sandbox' }).click();
    await expect(page.getByText('Sandbox', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Webhook URL')).toHaveValue(new RegExp(`/api/webhooks/telephony/telephony-sandbox/${slug}\\?event=inbound&token=.+`));
    await expect(page.getByText('Sandbox · keyword rules')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Call simulator' })).toBeVisible();
  });

  test('click-to-call → HUD → AI call notes', async () => {
    await page.goto(leadUrl);
    await page.getByRole('button', { name: 'Call', exact: true }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Conversation').selectOption({ label: 'Study in Canada enquiry' });
    await d.getByRole('button', { name: 'Start call' }).click();

    const hud = page.getByRole('status', { name: 'Call in progress' });
    await expect(hud).toBeVisible();
    await expect(hud.getByText(/Call ended · 3:34/)).toBeVisible({ timeout: 15_000 });
    await expect(hud.getByText('Call notes by Yu')).toBeVisible({ timeout: 15_000 });
    await expect(hud.getByText(/Discussed studying in Canada/)).toBeVisible();
    await hud.getByRole('link', { name: 'Open call →' }).click();
    await page.waitForURL(/\/calls\/[a-z0-9]+$/);

    await expect(page.getByRole('heading', { name: 'Call notes by Yu' })).toBeVisible();
    await expect(page.getByLabel('Call recording')).toHaveAttribute('src', /\/api\/files\/download\?t=/);
    await expect(page.getByText('Hello, this is Divya from Call Agency')).toBeVisible();
    await expect(page.getByText('IELTS 7.0', { exact: true })).toBeVisible();
    await expect(page.getByText('September 2027', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Add task' }).first().click();
    await expect(page.getByText('Added').first()).toBeVisible();
    await page.getByRole('button', { name: 'Apply to record' }).click();
    await expect(page.getByText('Applied to the record')).toBeVisible();
    await page.getByLabel('Call outcome').fill('Consultation booked');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

    await page.goto(leadUrl);
    await expect(page.getByText('Study · Canada')).toBeVisible();
    await expect(page.getByText('Send the document checklist').first()).toBeVisible(); // task
    await expect(page.getByText(/AI call notes: Discussed studying in Canada/)).toBeVisible(); // timeline
    await expect(page.getByRole('heading', { name: 'Calls' })).toBeVisible();
  });

  test('simulated incoming call is routed to the counsellor and summarised', async () => {
    await page.goto(`/${slug}/settings?tab=calling`);
    await page.getByLabel('Your mobile').fill('+91 98765 00000');
    await page.getByRole('button', { name: 'Save number' }).click();
    await expect(page.getByText('+919876500000')).toBeVisible();

    await page.getByLabel("Caller's number").fill('+91 98400 55667');
    await page.getByLabel('Conversation').selectOption({ label: 'Australia PR points query' });
    await page.getByRole('button', { name: 'Simulate incoming call' }).click();
    await page.getByRole('link', { name: 'Open call' }).click();
    await page.waitForURL(/\/calls\/[a-z0-9]+$/);
    await eventually(page, /Discussed permanent residency in Australia/);
    await expect(page.getByText('software engineer', { exact: true })).toBeVisible();
    await expect(page.getByText('Divya Caller').first()).toBeVisible(); // routed to the only counsellor with a phone

    // The unknown number became a lead from a call.
    const db = new Pg(DB);
    await db.connect();
    const { rows } = await db.query(
      `SELECT l."firstName", l.source FROM "Lead" l JOIN "Tenant" t ON t.id = l."tenantId" WHERE t.slug = $1 AND l."phoneNormalized" = '+919840055667'`,
      [slug],
    );
    await db.end();
    expect(rows).toEqual([{ firstName: 'Caller', source: 'CALL' }]);
  });

  test('telephony webhooks: token check, missed calls, wrong provider', async ({ request }) => {
    const token = await webhookToken();
    const url = (event: string, t = token) => `/api/webhooks/telephony/telephony-sandbox/${slug}?event=${event}&token=${t}`;
    expect((await request.post(url('inbound', 'forged'), { data: { kind: 'incoming', providerCallId: 'x', from: '+1', to: '+1' } })).status()).toBe(401);
    expect((await request.post(`/api/webhooks/telephony/twilio/${slug}?event=inbound&token=${token}`, { data: {} })).status()).toBe(404);

    const id = `CA_SBX_missed_${run}`;
    const inbound = await request.post(url('inbound'), { data: { kind: 'incoming', providerCallId: id, from: '+919840011223', to: '+910000000000' } });
    expect(inbound.status()).toBe(200);
    expect(await inbound.json()).toEqual({ forwardTo: ['+919876500000'] });
    expect((await request.post(url('status'), { data: { kind: 'status', providerCallId: id, status: 'no-answer' } })).status()).toBe(200);
    // Retried callbacks don't duplicate anything.
    expect((await request.post(url('status'), { data: { kind: 'status', providerCallId: id, status: 'no-answer' } })).status()).toBe(200);

    await page.goto(`/${slug}/calls?f=missed`);
    await expect(page.getByRole('link', { name: /Priya Raman/ })).toHaveCount(1);
    await expect(page.getByRole('link', { name: /Calls/ }).first()).toContainText('1'); // sidebar badge: missed today
  });

  test('call minutes are metered', async () => {
    await page.goto(`/${slug}/settings?tab=integrations`);
    await expect(page.locator('li', { hasText: 'Phone calls' }).getByText('Sandbox · Calling sandbox')).toBeVisible();
    await expect(page.getByRole('row', { name: /Phone calls telephony-sandbox \d+ minutes/ })).toBeVisible();
  });

  test('no browser console errors across the calling screens', async () => {
    expect(consoleErrors).toEqual([]);
  });
});
