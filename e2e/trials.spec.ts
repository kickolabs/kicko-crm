import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';
import { testMobile } from './helpers';

// One free trial per person: the owner verifies a mobile to start it; the same number
// can't be used by another account; a second workspace has to choose a plan;
// throwaway email addresses are refused.

const run = Date.now().toString(36);
const slug = `tr-${run}`;
const mobile = testMobile();
const DB = 'postgresql://postgres:postgres@localhost:5433/kicko';

async function status(s: string) {
  const db = new Pg(DB);
  await db.connect();
  try {
    return (await db.query(`SELECT s.status FROM "Subscription" s JOIN "Tenant" t ON t.id = s."tenantId" WHERE t.slug = $1`, [s])).rows[0]?.status as string;
  } finally {
    await db.end();
  }
}

async function fillSignUp(page: Page, o: { email: string; mobile: string; agency: string; slug: string }) {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Owner Trial');
  await page.getByLabel('Work email').fill(o.email);
  await page.getByLabel('Mobile number').fill(o.mobile);
  await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
  await page.getByLabel('Confirm password').fill('kicko-pass-123');
  await page.getByLabel('Agency name').fill(o.agency);
  await page.getByLabel('Workspace address').fill(o.slug);
  await page.getByRole('button', { name: 'Create account & workspace' }).click();
}

test.describe.serial('Free trials', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test('the trial starts only after the mobile is verified', async () => {
    await fillSignUp(page, { email: `tr-${run}@example.test`, mobile, agency: `Trial Agency ${run}`, slug });
    await page.waitForURL(/\/verify-mobile/);
    expect(await status(slug)).toBe('pending');

    // Leaving the page: the workspace says what's missing.
    await page.goto(`/${slug}`);
    await expect(page.getByText('Verify your mobile to start your 14-day free trial')).toBeVisible();
    await page.getByRole('link', { name: 'Verify now' }).click();

    await page.getByLabel('Code').fill('000000');
    await page.getByRole('button', { name: 'Verify & start free trial' }).click();
    await expect(page.getByText(/That code isn.t right/).first()).toBeVisible();

    const code = (await page.getByText(/Your code is \d{6}/).textContent())!.match(/\d{6}/)![0];
    await page.getByLabel('Code').fill(code);
    await page.getByRole('button', { name: 'Verify & start free trial' }).click();
    await page.waitForURL(`**/${slug}`);
    await expect(page.getByText(/Free trial: 14 days left/)).toBeVisible();
    expect(await status(slug)).toBe('trialing');
  });

  test('a second workspace for the same person has to choose a plan', async () => {
    await page.goto(`/signup?from=${slug}`);
    await page.getByLabel('Agency name').fill(`Second Agency ${run}`);
    await page.getByLabel('Workspace address').fill(`${slug}-2`);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.waitForURL(`**/${slug}-2/settings?tab=plan`);
    await expect(page.getByText('You’ve used your free trial. Choose a plan to start using this workspace.')).toBeVisible();
    await expect(page.getByText('No plan yet')).toBeVisible();
    expect(await status(`${slug}-2`)).toBe('pending');
  });

  test('another account can’t use the same mobile number', async ({ browser }) => {
    const other = await (await browser.newContext()).newPage();
    await fillSignUp(other, { email: `tr2-${run}@example.test`, mobile, agency: `Copy Agency ${run}`, slug: `${slug}-copy` });
    await expect(other.getByText('This mobile number is already used by another Kicko account. Sign in instead.').first()).toBeVisible();
    await expect(other).toHaveURL(/\/signup/);
  });

  test('throwaway email addresses are refused', async ({ browser }) => {
    const other = await (await browser.newContext()).newPage();
    await fillSignUp(other, { email: `tr3-${run}@mailinator.com`, mobile: testMobile(), agency: `Temp Agency ${run}`, slug: `${slug}-temp` });
    await expect(other.getByText('Temporary email addresses can’t be used').first()).toBeVisible();
  });
});
