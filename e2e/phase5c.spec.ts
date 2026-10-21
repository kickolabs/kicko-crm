import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';

// Phase 5c: AI voice agent in sandbox. Scripted callers talk to the agent, which
// calls our real tool webhooks (save details, slots, booking, human callback);
// the call-ended webhook carries the transcript. Covers auto-calling new web
// enquiries, manual AI calls, retries, the inbound receptionist and auth.

const run = Date.now().toString(36);
const slug = `p5c-${run}`;
const DB = 'postgresql://postgres:postgres@localhost:5433/kicko';

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const db = new Pg(DB);
  await db.connect();
  try {
    return (await db.query(sql, params)).rows as T[];
  } finally {
    await db.end();
  }
}

/** A timezone where it's currently inside calling hours (10:00–19:00), so calls start right away. */
function zoneInsideHours() {
  const zones = ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland', 'Pacific/Honolulu', 'Asia/Dubai', 'America/Sao_Paulo'];
  return (
    zones.find((tz) => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date());
      const hour = Number(parts.find((p) => p.type === 'hour')!.value);
      const day = parts.find((p) => p.type === 'weekday')!.value;
      return hour >= 10 && hour < 18 && day !== 'Sun';
    }) ?? 'Asia/Kolkata'
  );
}

const leadByPhone = (phone: string) =>
  q<{ id: string; firstName: string; status: string; score: number | null; interestCountry: string | null; interestCategory: string | null; email: string | null; lostReason: string | null }>(
    `SELECT l.id, l."firstName", l.status, l.score, l."interestCountry", l."interestCategory", l.email, l."lostReason" FROM "Lead" l JOIN "Tenant" t ON t.id = l."tenantId" WHERE t.slug = $1 AND l."phoneNormalized" = $2`,
    [slug, phone],
  ).then((r) => r[0]);

test.describe.serial('Phase 5c · AI voice agent (sandbox)', () => {
  let page: Page;
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
    });
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Vikram Owner');
    await page.getByLabel('Work email').fill(`p5c-${run}@example.test`);
    await page.getByLabel('Password').fill('kicko-pass-123');
    await page.getByLabel('Agency name').fill(`Voice Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await page.waitForURL(`**/${slug}`);
    await q(`UPDATE "Tenant" SET timezone = $1 WHERE slug = $2`, [zoneInsideHours(), slug]);
  });

  test('connect the sandbox and configure the agent', async () => {
    await page.goto(`/${slug}/settings?tab=voice`);
    await page.getByRole('button', { name: 'Try the voice agent in sandbox' }).click();
    await expect(page.getByText('Sandbox', { exact: true })).toBeVisible();
    await expect(page.getByText('Sandbox: no sync needed')).toBeVisible();

    await page.getByLabel('Agent name').fill('Asha');
    await page.getByLabel('Call new enquiries automatically').check();
    await page.getByLabel('Wait before calling (minutes)').fill('0');
    for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) await page.getByLabel(d, { exact: true }).check();
    await page.getByLabel('Calls from').fill('09:00');
    await page.getByLabel('Calls until').fill('21:00');
    await page.getByRole('button', { name: 'Save agent' }).click();
    await expect(page.getByText('Voice agent saved.')).toBeVisible();

    await page.getByText("View the agent's instructions").click();
    await expect(page.getByText(/You are Asha, an AI voice assistant for Voice Agency/)).toBeVisible();
    await expect(page.getByText(/Never give immigration advice/)).toBeVisible();
  });

  test('a new web enquiry is called within seconds, qualified and booked', async ({ request }) => {
    await page.goto(`/${slug}/settings?tab=capture`);
    const [{ key }] = await q<{ key: string }>(`SELECT settings->>'formKey' AS key FROM "Tenant" WHERE slug = $1`, [slug]);
    const phone = '+919840012345';
    const r = await request.post(`/api/public/${slug}/leads`, {
      headers: { 'x-form-key': key, 'content-type': 'application/json' },
      data: { firstName: 'Neha', lastName: 'Sharma', phone, message: 'Want to study abroad' },
    });
    expect(r.status()).toBe(201);

    await expect.poll(async () => (await leadByPhone(phone))?.status, { timeout: 20_000 }).toBe('CONSULT_BOOKED');
    const lead = await leadByPhone(phone);
    // Booking happens mid-call; the notes are written after it ends.
    await expect
      .poll(async () => (await q<{ s: string | null }>(`SELECT "aiStatus" AS s FROM "Call" WHERE "leadId" = $1`, [lead!.id]))[0]?.s, { timeout: 20_000 })
      .toBe('done');
    expect(lead).toMatchObject({ interestCountry: 'CA', interestCategory: 'STUDY', email: 'student.demo@example.com', score: 100 });
    const appts = await q(`SELECT mode FROM "Appointment" WHERE "leadId" = $1`, [lead!.id]);
    expect(appts).toEqual([{ mode: 'VIDEO' }]);

    await page.goto(`/${slug}/leads/${lead!.id}`);
    await expect(page.getByText('100/100')).toBeVisible();
    await expect(page.getByText(/AI voice agent: Discussed studying in Canada/)).toBeVisible();
    await page.getByRole('link', { name: /Outgoing · \d+m/ }).first().click();
    await page.waitForURL(/\/calls\//);
    await expect(page.getByText('AI agent · qualification')).toBeVisible();
    await expect(page.getByText(/Booked .+/).first()).toBeVisible(); // "Done during the call"
    await expect(page.getByText('Asha (AI)').first()).toBeVisible();
    await expect(page.getByText('IELTS 7.0 overall')).toBeVisible();
    await expect(page.getByLabel('Call recording')).toBeVisible();
  });

  test('AI call from the lead page: caller asks for a human', async () => {
    await page.goto(`/${slug}/leads?new=1`);
    const d = page.getByRole('dialog');
    await d.getByLabel('First name').fill('Arun');
    await d.getByLabel('Phone / WhatsApp').fill('9840022334');
    await d.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/leads\/[a-z0-9]+$/);

    await page.getByRole('button', { name: 'AI call' }).click();
    await page.getByRole('dialog').getByLabel('Sandbox caller').selectOption('pr-australia');
    await page.getByRole('dialog').getByRole('button', { name: 'Start AI call' }).click();
    const hud = page.getByRole('status', { name: 'Call in progress' });
    await expect(hud.getByText('AI call notes')).toBeVisible({ timeout: 20_000 });
    await expect(hud.getByText(/permanent residency in Australia/)).toBeVisible();

    const tasks = await q(`SELECT t.title FROM "Task" t JOIN "Lead" l ON l.id = t."leadId" JOIN "Tenant" w ON w.id = l."tenantId" WHERE w.slug = $1 AND l."phoneNormalized" = '+919840022334'`, [slug]);
    expect(tasks).toEqual([{ title: 'Call back: Arun (Wants a counsellor to explain points and fees)' }]);
    expect(await leadByPhone('+919840022334')).toMatchObject({ status: 'QUALIFIED', interestCountry: 'AU', interestCategory: 'PR' });
  });

  test('not interested → lead lost; no answer → retry scheduled', async () => {
    for (const [first, phone, persona] of [['Kiran', '9840033445', 'not-interested'], ['Meena', '9840044556', 'no-answer']] as const) {
      await page.goto(`/${slug}/leads?new=1`);
      const d = page.getByRole('dialog');
      await d.getByLabel('First name').fill(first);
      await d.getByLabel('Phone / WhatsApp').fill(phone);
      await d.getByRole('button', { name: 'Create lead' }).click();
      await page.waitForURL(/\/leads\/[a-z0-9]+$/);
      await page.getByRole('button', { name: 'AI call' }).click();
      await page.getByRole('dialog').getByLabel('Sandbox caller').selectOption(persona);
      await page.getByRole('dialog').getByRole('button', { name: 'Start AI call' }).click();
      await expect(page.getByRole('status', { name: 'Call in progress' }).getByRole('link', { name: 'Open call →' })).toBeVisible({ timeout: 20_000 });
    }
    expect(await leadByPhone('+919840033445')).toMatchObject({ status: 'LOST', lostReason: 'Not interested (AI call)' });

    // The retry is queued just after the call is marked unanswered, so wait for it.
    await expect
      .poll(() =>
        q<{ status: string; attempt: number }>(
          `SELECT c.status, c.attempt FROM "Call" c JOIN "Lead" l ON l.id = c."leadId" JOIN "Tenant" w ON w.id = l."tenantId" WHERE w.slug = $1 AND l."phoneNormalized" = '+919840044556' ORDER BY c.attempt`,
          [slug],
        ),
      )
      .toEqual([{ status: 'NO_ANSWER', attempt: 1 }, { status: 'QUEUED', attempt: 2 }]);
    await page.goto(`/${slug}/settings?tab=voice`);
    await expect(page.getByText(/attempt 2/)).toBeVisible();
  });

  test('AI receptionist answers an inbound call', async () => {
    await page.goto(`/${slug}/settings?tab=voice`);
    await page.getByLabel("Caller's number").fill('+91 98400 77881');
    await page.getByLabel('Caller', { exact: true }).selectOption('student-canada');
    await page.getByRole('button', { name: 'Simulate incoming call' }).click();
    await page.getByRole('link', { name: 'Open call', exact: true }).click();
    await page.waitForURL(/\/calls\/[a-z0-9]+$/);
    await expect(async () => {
      await page.reload();
      await expect(page.getByText(/Discussed studying in Canada/).first()).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByText('AI agent · receptionist')).toBeVisible();
    await expect(page.getByText(/Thank you for calling Voice Agency/)).toBeVisible();
    expect(await leadByPhone('+919840077881')).toMatchObject({ status: 'CONSULT_BOOKED' });
  });

  test('voice webhooks: token check and wrong provider; minutes metered', async ({ request }) => {
    const body = { kind: 'tool', name: 'get_available_slots', args: { call_ref: 'x' } };
    expect((await request.post(`/api/webhooks/voice_agent/voice-sandbox/${slug}?event=tool&token=forged`, { data: body })).status()).toBe(401);
    expect((await request.post(`/api/webhooks/voice_agent/retell/${slug}?event=tool&token=x`, { data: body })).status()).toBe(404);

    await page.goto(`/${slug}/settings?tab=integrations`);
    await expect(page.locator('li', { hasText: 'AI voice agent' }).getByText('Sandbox · Voice agent sandbox')).toBeVisible();
    await expect(page.getByRole('row', { name: /AI voice agent voice-sandbox \d+ minutes/ })).toBeVisible();
  });

  test('no browser console errors', async () => {
    expect(consoleErrors).toEqual([]);
  });
});
