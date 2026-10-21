import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';

// Phase 7b: Kicko's super-admin console. Only allowlisted, verified staff get in;
// they can see every agency and extend a trial, set a discount, add credits, set a
// plan by hand, suspend and reactivate, with each change logged.

const run = Date.now().toString(36);
const slug = `p7b-${run}`;
const agency = `Console Agency ${run}`;
const ADMIN = { email: 'ops-e2e@kicko.test', password: 'kicko-admin-123' }; // in SUPER_ADMIN_EMAILS (.env)
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
const sub = async () =>
  (await q<{ status: string; trialEndsAt: Date | null; discountPct: number; topUpCredits: number; plan: string; seats: number; provider: string | null }>(
    `SELECT s.* FROM "Subscription" s JOIN "Tenant" t ON t.id = s."tenantId" WHERE t.slug = $1`,
    [slug],
  ))[0]!;

test.describe.serial('Phase 7b · super-admin console', () => {
  let owner: Page;
  let admin: Page;
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser, request }) => {
    owner = await browser.newPage();
    await owner.goto('/signup');
    await owner.getByLabel('Your name').fill('Owner Console');
    await owner.getByLabel('Work email').fill(`p7b-${run}@example.test`);
    await owner.getByLabel('Password').fill('kicko-pass-123');
    await owner.getByLabel('Agency name').fill(agency);
    await owner.getByLabel('Workspace address').fill(slug);
    await owner.getByRole('button', { name: 'Create account & workspace' }).click();
    await owner.waitForURL(`**/${slug}`);

    // The Kicko staff account (no workspace of its own). Re-runs reuse it.
    await request.post('/api/auth/sign-up/email', { data: { name: 'Kicko Ops', ...ADMIN } });
    await q(`UPDATE "user" SET "emailVerified" = false WHERE email = $1`, [ADMIN.email]);

    admin = await browser.newPage();
    admin.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
    });
    await admin.goto('/login');
    await admin.getByLabel('Email').fill(ADMIN.email);
    await admin.getByLabel('Password').fill(ADMIN.password);
    await admin.getByRole('button', { name: /sign in/i }).click();
    await admin.waitForURL((u) => !u.pathname.startsWith('/login'));
  });

  test('the console is a 404 for agency staff, and for unverified admin emails', async () => {
    expect((await owner.goto('/admin'))!.status()).toBe(404);
    expect((await admin.goto('/admin'))!.status()).toBe(404); // allowlisted, not yet granted
    await q(`UPDATE "user" SET "emailVerified" = true WHERE email = $1`, [ADMIN.email]); // what `npm run admin:grant` does
    expect((await admin.goto('/admin'))!.status()).toBe(200);
    // A staff account has no workspace: home takes it to the console.
    await admin.goto('/');
    await admin.waitForURL('**/admin');
  });

  test('lists every agency with plan, trial and usage', async () => {
    await expect(admin.getByRole('heading', { name: 'Agencies', exact: true })).toBeVisible();
    await expect(admin.locator('th', { hasText: 'MRR' })).toBeVisible();
    await admin.getByLabel('Search agencies').fill(slug); // filters instantly, no reload
    await admin.waitForURL(/q=p7b-/);
    await expect(admin.locator('tbody tr')).toHaveCount(1);
    const row = admin.getByRole('row').filter({ hasText: agency });
    await expect(row).toContainText('Free trial');
    await expect(row).toContainText('Trial · 14 days left');
    await expect(row).toContainText(`p7b-${run}@example.test`);
    await admin.getByRole('tab', { name: /^Paying/ }).click();
    await expect(admin.getByRole('row').filter({ hasText: agency })).toHaveCount(0);
    await admin.getByRole('tab', { name: /^Trial \d/ }).click();
    await expect(admin.getByRole('row').filter({ hasText: agency })).toBeVisible();
    await row.getByRole('link', { name: agency }).click();
    await expect(admin.getByRole('heading', { name: agency })).toBeVisible();
  });

  test('extend the trial; a reason is required and the change is logged', async () => {
    const tool = admin.getByRole('region', { name: 'Extend trial' });
    await tool.getByLabel('Days', { exact: true }).fill('7');
    await tool.getByRole('button', { name: 'Extend trial' }).click();
    await expect(tool.getByText('Say why (at least 3 characters)')).toBeVisible();
    await tool.getByLabel('Reason (trial)').fill('Needs a week more for team training');
    await tool.getByRole('button', { name: 'Extend trial' }).click();
    await expect(tool.getByText('Trial extended')).toBeVisible();
    await expect(admin.getByText('21 days left', { exact: false })).toBeVisible();
    await expect(admin.getByText('+7 days · Needs a week more for team training')).toBeVisible();
    const s = await sub();
    expect(Math.round((s.trialEndsAt!.getTime() - Date.now()) / 86400_000)).toBe(21);
  });

  test('founding discount and goodwill credits reach the agency', async () => {
    const d = admin.getByRole('region', { name: 'Discount' });
    await d.getByLabel('Discount %', { exact: true }).fill('30');
    await d.getByLabel('Reason (discount)').fill('Founding customer #1');
    await d.getByRole('button', { name: 'Save discount' }).click();
    await expect(d.getByText('Discount saved')).toBeVisible();
    const c = admin.getByRole('region', { name: 'Add AI credits' });
    await c.getByLabel('Credits', { exact: true }).fill('500');
    await c.getByLabel('Reason (credits)').fill('Sorry for the outage');
    await c.getByRole('button', { name: 'Add credits' }).click();
    await expect(c.getByText('Credits added')).toBeVisible();
    expect(await sub()).toMatchObject({ discountPct: 30, topUpCredits: 500 });

    await owner.goto(`/${slug}/settings?tab=plan`);
    await expect(owner.getByText('30% founding discount')).toBeVisible();
    await expect(owner.getByText(/Purchased credits left: 500/)).toBeVisible();
  });

  test('set a plan by hand (bank transfer / complimentary)', async () => {
    const p = admin.getByRole('region', { name: 'Set plan by hand' });
    await p.getByLabel('Plan', { exact: true }).selectOption('growth');
    await p.getByLabel('Seats', { exact: true }).fill('3');
    await p.getByLabel('Months', { exact: true }).fill('12');
    await p.getByLabel('Reason (plan)').fill('Paid by NEFT, UTR 1234');
    await p.getByRole('button', { name: 'Set plan' }).click();
    await expect(p.getByText('Plan updated')).toBeVisible();
    expect(await sub()).toMatchObject({ status: 'active', plan: 'growth', seats: 3, provider: 'manual' });
    // Trials can't be extended once on a plan.
    const t = admin.getByRole('region', { name: 'Extend trial' });
    await t.getByLabel('Reason (trial)').fill('try again');
    await t.getByRole('button', { name: 'Extend trial' }).click();
    await expect(t.getByText(/on a paid plan/)).toBeVisible();

    await owner.goto(`/${slug}/settings?tab=plan`);
    await expect(owner.getByText('Active', { exact: true })).toBeVisible();
    await expect(owner.getByText(/\(complimentary\)/)).toBeVisible();
  });

  test('suspend locks the agency out; reactivate restores it', async () => {
    const s = admin.getByRole('region', { name: 'Suspend' });
    await s.getByLabel('Reason (suspend)').fill('Chargeback under review');
    await s.getByRole('button', { name: 'Suspend agency' }).click();
    await expect(admin.getByRole('region', { name: 'Reactivate' })).toBeVisible();
    await owner.goto(`/${slug}`);
    await expect(owner.getByRole('heading', { name: `${agency} is suspended` })).toBeVisible();

    const r = admin.getByRole('region', { name: 'Reactivate' });
    await r.getByLabel('Reason (reactivate)').fill('Chargeback resolved');
    await r.getByRole('button', { name: 'Reactivate' }).click();
    await expect(admin.getByRole('region', { name: 'Suspend' })).toBeVisible();
    expect((await sub()).status).toBe('active');
    await owner.goto(`/${slug}`);
    await expect(owner.getByRole('heading', { name: `${agency} is suspended` })).toHaveCount(0);

    const log = await q<{ action: string; actorEmail: string }>(
      `SELECT a.action, a."actorEmail" FROM "AdminAction" a JOIN "Tenant" t ON t.id = a."tenantId" WHERE t.slug = $1 ORDER BY a."createdAt"`,
      [slug],
    );
    expect(log.map((l) => l.action)).toEqual(['extend_trial', 'set_discount', 'add_credits', 'set_plan', 'suspend', 'reactivate']);
    expect(new Set(log.map((l) => l.actorEmail))).toEqual(new Set([ADMIN.email]));
  });

  test('no browser console errors', async () => {
    expect(consoleErrors).toEqual([]);
  });
});
