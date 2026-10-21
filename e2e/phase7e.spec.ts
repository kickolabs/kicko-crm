import { expect, test, type Page } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { Client as Pg } from 'pg';
import { enableTwoStep, totp } from './totp';

// Phase 7e: two-step sign-in (set up, sign in with a code or backup code, agency
// requirement), the audit log, and the full data export.

const run = Date.now().toString(36);
const slug = `p7e-${run}`;
const OWNER = { email: `p7e-${run}@example.test`, password: 'kicko-pass-123' };
const STAFF = { email: `p7e-staff-${run}@example.test`, password: 'kicko-pass-456', name: 'Staff Member' };
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

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signOut(page: Page) {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');
}

test.describe.serial('Phase 7e · trust & security', () => {
  let page: Page;
  let secret = '';
  let backup: string[] = [];
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
    });
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Owner Secure');
    await page.getByLabel('Work email').fill(OWNER.email);
    await page.getByLabel('Password').fill(OWNER.password);
    await page.getByLabel('Agency name').fill(`Secure Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await page.waitForURL(`**/${slug}`);
  });

  test('turn on two-step sign-in from My account', async () => {
    await page.getByRole('button', { name: /^Account:/ }).click();
    await page.getByRole('menuitem', { name: 'My account & security' }).click();
    await page.waitForURL('**/account');
    ({ secret, codes: backup } = await enableTwoStep(page, OWNER.password));
    expect(backup).toHaveLength(10);
    const [u] = await q<{ on: boolean }>(`SELECT "twoFactorEnabled" AS on FROM "user" WHERE email = $1`, [OWNER.email]);
    expect(u!.on).toBe(true);
  });

  test('sign-in now needs the code; a wrong one is refused', async () => {
    await signOut(page);
    await signIn(page, { ...OWNER, password: 'wrong-password' });
    await expect(page.getByText('Wrong email or password.')).toBeVisible();
    await signIn(page, OWNER);
    await page.waitForURL(/\/login\/verify/);
    await page.getByLabel('Code').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText(/That code didn’t work/)).toBeVisible();
    await page.getByLabel('Code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL(`**/${slug}`);
  });

  test('a backup code works once', async () => {
    await signOut(page);
    await signIn(page, OWNER);
    await page.waitForURL(/\/login\/verify/);
    await page.getByRole('button', { name: 'Lost your phone? Use a backup code' }).click();
    await page.getByLabel('Backup code').fill(backup[0]!);
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL(`**/${slug}`);
  });

  test('owners can require it for everyone; staff without it are sent to set it up', async ({ browser, request }) => {
    // A second team member without 2FA.
    await request.post('/api/auth/sign-up/email', { data: { name: STAFF.name, email: STAFF.email, password: STAFF.password } });
    await q(
      `INSERT INTO "Membership" (id, "tenantId", "userId", role, active, "createdAt")
       SELECT 'm-' || $2, t.id, u.id, 'COUNSELLOR', true, now() FROM "Tenant" t, "user" u WHERE t.slug = $1 AND u.email = $3`,
      [slug, run, STAFF.email],
    );
    await page.goto(`/${slug}/settings?tab=security`);
    await expect(page.getByText('1 of 2 use it')).toBeVisible();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Require for everyone' }).click();
    await expect(page.getByText(/Required for everyone/)).toBeVisible();

    const staff = await browser.newPage();
    await signIn(staff, STAFF); // lands on the workspace, which sends them to set up 2FA
    await staff.waitForURL(/\/account\?required=/);
    await staff.goto(`/${slug}/leads`);
    await staff.waitForURL(/\/account\?required=/);
    await expect(staff.getByText(`Secure Agency ${run} requires two-step sign-in`)).toBeVisible();
    await enableTwoStep(staff, STAFF.password);
    await expect(staff.getByText('Your agency requires two-step sign-in, so it can’t be turned off.')).toBeVisible();
    await staff.goto(`/${slug}/leads`);
    await expect(staff.getByRole('heading', { name: 'Leads', exact: true })).toBeVisible();
    await staff.close();
  });

  test('the audit log shows who did what, and can be filtered', async () => {
    await page.goto(`/${slug}/settings?tab=security`);
    const log = page.getByRole('list', { name: 'Audit events' });
    await expect(log).toContainText('Turned on two-step sign-in');
    await expect(log).toContainText('Failed sign-in (wrong password)');
    await expect(log).toContainText('with two-step code');
    await expect(log).toContainText('with a backup code');
    await expect(log).toContainText('Required two-step sign-in for everyone');
    await page.getByLabel('Type of event').selectOption({ label: 'Settings' });
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.waitForURL(/group=settings/);
    await expect(log).toContainText('Required two-step sign-in for everyone');
    await expect(log).not.toContainText('Failed sign-in');
    // Every event above was stored (append-only is checked in packages/db/test/rls.test.ts).
    const rows = await q<{ n: number }>(`SELECT count(*)::int AS n FROM "AuditEvent" WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = $1)`, [slug]);
    expect(rows[0]!.n).toBeGreaterThan(5);
  });

  test('export all data as a ZIP of CSVs (and not twice in a minute)', async () => {
    const res = await page.request.get(`/api/t/${slug}/export`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await res.body()));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['README.txt', 'leads.csv', 'clients.csv', 'cases.csv', 'payments.csv', 'audit_log.csv', 'team.csv']));
    expect(strFromU8(files['README.txt']!)).toContain(`Secure Agency ${run}: full data export`);
    const team = strFromU8(files['team.csv']!).replace(/^﻿/, '');
    expect(team.split('\n')[0]).toContain('userId');
    expect(team).not.toContain('tenantId');
    expect((await page.request.get(`/api/t/${slug}/export`)).status()).toBe(429);
    await page.goto(`/${slug}/settings?tab=security`);
    await expect(page.getByRole('list', { name: 'Audit events' })).toContainText('Exported all agency data (ZIP)');
  });

  test('no browser console errors', async () => {
    expect(consoleErrors).toEqual([]);
  });
});
