import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';
import { testMobile, verifyMobile } from './helpers';

// Phase 7a: plans and billing (sandbox). Trial → choose Growth → checkout →
// active + GST invoice → plan gating → seats → credit top-up → lapse to
// read-only (Postgres refuses writes) → suspended → renew.

const run = Date.now().toString(36);
const slug = `p7a-${run}`;
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
const setSub = (fields: string, params: unknown[] = []) =>
  q(`UPDATE "Subscription" SET ${fields} WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = $1)`, [slug, ...params]);

test.describe.serial('Phase 7a · plans & billing', () => {
  let page: Page;
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
    });
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Owner Billing');
    await page.getByLabel('Work email').fill(`p7a-${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await page.getByLabel('Confirm password').fill('kicko-pass-123');
    await page.getByLabel('Mobile number').fill(testMobile());
    await page.getByLabel('Agency name').fill(`Billing Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await verifyMobile(page);
    await page.waitForURL(`**/${slug}`);
  });

  test('a new workspace is on a 14-day trial with everything included', async () => {
    await expect(page.getByText(/Free trial: 14 days left/)).toBeVisible();
    await page.goto(`/${slug}/partners/agents`);
    await expect(page.getByRole('heading', { name: 'Sub-agents', exact: true })).toBeVisible(); // Pro feature works in trial
  });

  test('choose Growth yearly for 2 users → checkout → active, with a GST invoice', async () => {
    await page.goto(`/${slug}/settings?tab=plan`);
    await expect(page.getByText('Free trial · everything included')).toBeVisible();
    await page.getByLabel('Users').fill('2');
    await expect(page.getByText('₹56,611.68 per year incl. GST')).toBeVisible(); // 1,999 × 2 × 12 = 47,976 + 18%
    await page.getByRole('button', { name: 'Choose Growth' }).click();
    await page.waitForURL(/\/checkout\/sandbox/);
    await expect(page.getByText('Growth plan · 2 users · yearly')).toBeVisible();
    await expect(page.getByText('₹56,611.68')).toBeVisible();
    await page.getByRole('button', { name: 'Simulate successful payment' }).click();
    await page.waitForURL(/settings\?tab=plan&paid=1/);
    await expect(page.getByText('Payment received. Thank you!')).toBeVisible();
    await expect(page.getByText('Growth', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText(/Free trial:/)).toHaveCount(0);

    const invoice = page.getByRole('listitem').filter({ hasText: /KCK\/\d{2}-\d{2}\/\d{4}/ }).first();
    await expect(invoice).toContainText('Kicko Growth, 2 users, annual subscription');
    await expect(invoice).toContainText('₹56,611.68');
    const pdf = await page.request.get((await invoice.getByRole('link', { name: 'PDF' }).getAttribute('href'))!);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    const [inv] = await q<{ subtotal: number; cgst: number; sgst: number; igst: number }>(
      `SELECT i.subtotal, i.cgst, i.sgst, i.igst FROM "PlatformInvoice" i JOIN "Tenant" t ON t.id = i."tenantId" WHERE t.slug = $1`,
      [slug],
    );
    expect(inv).toEqual({ subtotal: 4_797_600, cgst: 431_784, sgst: 431_784, igst: 0 }); // no buyer GSTIN → CGST + SGST
  });

  test('plan gating: Growth has calling but not the sub-agent network', async () => {
    await page.goto(`/${slug}/partners/agents`);
    await expect(page.getByText('Sub-agent network is part of the Pro plan')).toBeVisible();
    await page.goto(`/${slug}/calls`);
    await expect(page.getByRole('heading', { name: 'Calls', exact: true })).toBeVisible();
  });

  test('seats: 2 users means one invite, then a clear limit', async () => {
    await page.goto(`/${slug}/settings?tab=team`);
    await page.getByLabel('Email').fill(`one-${run}@example.test`);
    await page.getByRole('button', { name: 'Create invite' }).click();
    await expect(page.getByLabel('Invite link')).toBeVisible();
    await page.getByLabel('Email').fill(`two-${run}@example.test`);
    await page.getByRole('button', { name: 'Create invite' }).click();
    await expect(page.getByText(/All 2 seats are in use/)).toBeVisible();
  });

  test('buy AI credits', async () => {
    await page.goto(`/${slug}/settings?tab=plan`);
    await expect(page.getByText(/of 600 used this month/)).toBeVisible(); // 300 × 2 users
    await page.getByRole('button', { name: /Buy 1,000 credits/ }).click();
    await page.waitForURL(/\/checkout\/sandbox/);
    await expect(page.getByText('1,000 AI credits')).toBeVisible();
    await page.getByRole('button', { name: 'Simulate successful payment' }).click();
    await page.waitForURL(/settings\?tab=plan/);
    await expect(page.getByText(/Purchased credits left: 1,000/)).toBeVisible();
  });

  test('a lapsed workspace is read-only: viewing works, Postgres refuses edits', async () => {
    await setSub(`status = 'read_only', "statusSince" = now()`);
    await page.goto(`/${slug}/leads`);
    await expect(page.getByText(/This workspace is read-only/)).toBeVisible();
    await page.goto(`/${slug}/leads?new=1`);
    const d = page.getByRole('dialog');
    await d.getByLabel('First name').fill('Blocked');
    await d.getByLabel('Phone / WhatsApp').fill('9840000111');
    await d.getByRole('button', { name: 'Create lead' }).click();
    await expect(d.getByText(/read-only because the subscription has ended/)).toBeVisible();
    expect(await q(`SELECT 1 FROM "Lead" l JOIN "Tenant" t ON t.id = l."tenantId" WHERE t.slug = $1 AND l."firstName" = 'Blocked'`, [slug])).toHaveLength(0);
  });

  test('suspended: the workspace is replaced by a renew screen; paying restores it', async () => {
    await setSub(`status = 'suspended', "statusSince" = now()`);
    await page.goto(`/${slug}`);
    await expect(page.getByRole('heading', { name: `Billing Agency ${run} is suspended` })).toBeVisible();
    await page.getByRole('button', { name: 'Choose Starter' }).click();
    await page.waitForURL(/\/checkout\/sandbox/);
    await page.getByRole('button', { name: 'Simulate successful payment' }).click();
    await page.waitForURL(/settings\?tab=plan/);
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText('Starter', { exact: true }).first()).toBeVisible();
    // Starter has no AI features: no credits to show or buy.
    await expect(page.getByRole('heading', { name: 'AI credits' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Buy 1,000 credits/ })).toHaveCount(0);
  });

  test('daily job moves an expired trial to read-only; forged billing webhooks are refused', async ({ request }) => {
    await setSub(`status = 'trialing', "statusSince" = now() - interval '15 days', "trialEndsAt" = now() - interval '1 day'`);
    const env = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
    const secret = env.match(/^CRON_SECRET="?([^"\n]+)"?/m)![1]!;
    const cron = await request.get('/api/cron/daily', { headers: { Authorization: `Bearer ${secret}` } });
    expect(cron.status()).toBe(200);
    expect((await cron.json()).billing[slug]).toBe('read_only');
    expect((await request.post('/api/webhooks/platform/billing-sandbox', { data: { events: [] }, headers: { 'x-sandbox-signature': 'forged' } })).status()).toBe(401);
    expect((await request.post('/api/webhooks/platform/razorpay', { data: {} })).status()).toBe(404); // not the configured provider
  });

  test('no browser console errors', async () => {
    expect(consoleErrors).toEqual([]);
  });
});
