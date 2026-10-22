import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';
import { testMobile, verifyMobile } from './helpers';

// Branches inside a workspace: Growth 3, Pro unlimited, Starter 1. New leads take
// their owner's branch; lists filter by branch; a downgrade keeps existing branches.

const run = Date.now().toString(36);
const slug = `br-${run}`;
const DB = 'postgresql://postgres:postgres@localhost:5433/kicko';

async function setSub(fields: string) {
  const db = new Pg(DB);
  await db.connect();
  try {
    await db.query(`UPDATE "Subscription" SET ${fields} WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = $1)`, [slug]);
  } finally {
    await db.end();
  }
}

test.describe.serial('Branches', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Owner Branch');
    await page.getByLabel('Work email').fill(`br-${run}@example.test`);
    await page.getByLabel('Mobile number').fill(testMobile());
    await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await page.getByLabel('Confirm password').fill('kicko-pass-123');
    await page.getByLabel('Agency name').fill(`Branch Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await verifyMobile(page);
    await page.waitForURL(`**/${slug}`);
    await setSub(`plan = 'growth', status = 'active', "trialEndsAt" = NULL, "currentPeriodEnd" = now() + interval '30 days'`);
  });

  const add = async (name: string) => {
    await page.getByLabel('New branch name').fill(name);
    await page.getByRole('button', { name: 'Add branch' }).click();
  };

  test('Growth includes 3 branches; the 4th asks for Pro', async () => {
    await page.goto(`/${slug}/settings?tab=branches`);
    await expect(page.getByText('1 of 3 on your plan')).toBeVisible();
    await add('Coimbatore');
    await expect(page.getByText('2 of 3 on your plan')).toBeVisible();
    await add('Madurai');
    await expect(page.getByText('3 of 3 on your plan')).toBeVisible();
    await expect(page.getByText('Growth includes 3 branches. Upgrade to Pro for unlimited branches.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add branch' })).toHaveCount(0);
  });

  test('a new lead takes its owner’s branch, and the list filters by branch', async () => {
    await page.goto(`/${slug}/settings?tab=team`);
    await page.getByLabel('Branch for Owner Branch').selectOption({ label: 'Madurai' });
    await page.waitForTimeout(500);

    await page.goto(`/${slug}/leads?new=1`);
    const d = page.getByRole('dialog');
    await d.getByLabel('First name').fill('Meena');
    await d.getByLabel('Last name').fill('Kumari');
    await d.getByLabel('Phone / WhatsApp').fill('9840022334');
    await d.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/leads\//);
    await expect(page.locator('#lead-branch option:checked')).toHaveText('Madurai');

    await page.goto(`/${slug}/leads?view=table`);
    await page.getByRole('combobox', { name: 'Branch', exact: true }).selectOption({ label: 'Coimbatore' });
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('link', { name: 'Meena Kumari' })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Branch', exact: true }).selectOption({ label: 'Madurai' });
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('link', { name: 'Meena Kumari' }).first()).toBeVisible();
  });

  test('after a downgrade to Starter, branches are kept but no new ones', async () => {
    await setSub(`plan = 'starter'`);
    await page.goto(`/${slug}/settings?tab=branches`);
    await expect(page.getByText(/You have 3 branches; Starter includes 1 branch/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add branch' })).toHaveCount(0);
    await expect(page.getByLabel('Branch name', { exact: true })).toHaveCount(3); // rows still there, editable
  });
});
