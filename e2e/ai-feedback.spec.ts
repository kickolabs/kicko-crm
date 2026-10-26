import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';
import { testMobile, verifyMobile, choose } from './helpers';

// "Help improve Kicko Yu": off by default (nothing recorded); on, verifying a
// document Yu flagged stores one anonymised row; off again deletes them.

const run = Date.now().toString(36);
const slug = `yu-${run}`;
const DB = 'postgresql://postgres:postgres@localhost:5433/kicko';
const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF ${name}`),
});

async function feedback() {
  const db = new Pg(DB);
  await db.connect();
  try {
    return (await db.query(`SELECT f.task, f.output, f.outcome, f.agreed FROM "AiFeedback" f JOIN "Tenant" t ON t.id = f."tenantId" WHERE t.slug = $1`, [slug])).rows;
  } finally {
    await db.end();
  }
}

test.describe.serial('Kicko Yu feedback (opt-in)', () => {
  let page: Page;
  let caseUrl = '';

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Owner Yu');
    await page.getByLabel('Work email').fill(`yu-${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await page.getByLabel('Confirm password').fill('kicko-pass-123');
    await page.getByLabel('Mobile number').fill(testMobile());
    await page.getByLabel('Agency name').fill(`Yu Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await verifyMobile(page);
    await page.waitForURL(`**/${slug}`);

    await page.goto(`/${slug}/leads?new=1`);
    const d = page.getByRole('dialog');
    await d.getByLabel('First name').fill('Priya');
    await d.getByLabel('Last name').fill('Raman');
    await d.getByLabel('Phone / WhatsApp').fill('9840011224');
    await choose(d, 'Country', 'Canada');
    await d.getByLabel('Visa product').selectOption({ label: 'Canada · Study Permit' });
    await d.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/leads\//);
    await page.getByRole('button', { name: 'Convert to client →' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
    await page.waitForURL(/\/cases\//);
    caseUrl = page.url();
  });

  async function verifyFlagged(doc: string, file: string) {
    await page.goto(caseUrl);
    await page.getByLabel(`Upload ${doc}`).setInputFiles(pdf(file));
    const row = page.locator('li', { hasText: doc }).first();
    await expect(row.getByText(/Yu: 1 issue/)).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: 'Review' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  test('off by default: verifying a flagged document records nothing', async () => {
    await verifyFlagged('Passport (all pages)', 'Priya_bank_statement.pdf');
    expect(await feedback()).toHaveLength(0);
  });

  test('on: one anonymised example, and the settings page counts it', async () => {
    await page.goto(`/${slug}/settings?tab=integrations`);
    await page.getByLabel(/Help improve Kicko Yu/).check();
    await page.getByRole('button', { name: 'Save' }).last().click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await verifyFlagged('Passport-size photographs', 'Priya_Raman_bank_statement_9840011224.pdf');
    const rows = await feedback();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task: 'document_check', agreed: false, outcome: { decision: 'VERIFIED' } });
    const text = JSON.stringify(rows[0]);
    expect(text).not.toMatch(/Priya|Raman|9840011224/);

    await page.goto(`/${slug}/settings?tab=integrations`);
    await expect(page.getByText('1 example shared so far.')).toBeVisible();
  });

  test('switching it off deletes what was shared', async () => {
    await page.getByLabel(/Help improve Kicko Yu/).uncheck();
    await page.getByRole('button', { name: 'Save' }).last().click();
    await expect(page.getByText('Saved.')).toBeVisible();
    expect(await feedback()).toHaveLength(0);
  });
});
