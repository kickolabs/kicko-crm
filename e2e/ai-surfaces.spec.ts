import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';

// Kicko Yu follows the plan: the daily brief, the sidebar's agent status and
// the case page's Yu flags. Trial and Pro get everything, Growth part of it,
// Starter none (admins see where to get it), read-only gets the basic brief.

const run = Date.now().toString(36);
const slug = `ai-${run}`;
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

const agents = (page: Page) => page.getByRole('group', { name: 'Kicko Yu' });
const yu = (page: Page) => page.getByRole('complementary', { name: 'Kicko Yu' });

test.describe.serial('AI surfaces by plan', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Owner AI');
    await page.getByLabel('Work email').fill(`ai-${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await page.getByLabel('Confirm password').fill('kicko-pass-123');
    await page.getByLabel('Agency name').fill(`AI Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await page.waitForURL(`**/${slug}`);
  });

  test('trial: Yu brief and every AI agent', async () => {
    await expect(yu(page).getByRole('heading', { name: 'Yu', exact: true })).toBeVisible();
    await expect(yu(page).getByText("Yu's suggestions are advisory")).toBeVisible();
    await expect(agents(page).getByRole('link')).toHaveText(['Voice · not set up', 'WhatsApp · off', 'Call notes · on', 'Doc check · on']);
  });

  test('Growth: Yu brief, WhatsApp AI and call notes; no voice agent or doc checks', async () => {
    await setSub(`plan = 'growth', status = 'active', "trialEndsAt" = NULL, "currentPeriodEnd" = now() + interval '30 days'`);
    await page.reload();
    await expect(yu(page).getByText("Yu's suggestions are advisory")).toBeVisible();
    await expect(agents(page).getByRole('link')).toHaveText(['WhatsApp · off', 'Call notes · on']);
  });

  test('Starter: no AI anywhere; the owner sees where to get Kicko Yu', async () => {
    await setSub(`plan = 'starter'`);
    await page.reload();
    await expect(agents(page)).toHaveCount(0);
    await expect(yu(page).getByRole('link', { name: 'See Growth' })).toBeVisible();
    await expect(yu(page).getByText("Yu's suggestions are advisory")).toHaveCount(0);
    // The command bar doesn't promise AI commands either.
    await page.getByLabel('Search or jump to').click();
    await expect(page.getByText('Plain-English commands')).toHaveCount(0);
  });

  test('read-only workspace keeps the brief, without AI writing it', async () => {
    await setSub(`plan = 'pro', status = 'read_only', "statusSince" = now()`);
    await page.reload();
    await expect(yu(page).getByText("Yu's suggestions are advisory")).toBeVisible();
    await expect(agents(page).getByRole('link')).toHaveCount(4);
  });
});
