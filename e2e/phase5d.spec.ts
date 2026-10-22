import { expect, test, type Page } from '@playwright/test';

// Phase 5d: eligibility calculators (code-computed, explained) and AI document
// checks (sandbox: file name, type and size only).

const run = Date.now().toString(36);
const slug = `p5d-${run}`;
const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF ${name}`),
});

test.describe.serial('Phase 5d · eligibility & document checks', () => {
  let page: Page;
  let caseUrl = '';
  let clientUrl = '';
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
    });
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Owner Fived');
    await page.getByLabel('Work email').fill(`p5d-${run}@example.test`);
    await page.getByLabel('Password').fill('kicko-pass-123');
    await page.getByLabel('Agency name').fill(`Points Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await page.waitForURL(`**/${slug}`);

    await page.goto(`/${slug}/leads?new=1`);
    const d = page.getByRole('dialog');
    await d.getByLabel('First name').fill('Priya');
    await d.getByLabel('Last name').fill('Raman');
    await d.getByLabel('Phone / WhatsApp').fill('9840011223');
    await d.getByLabel('Visa product').selectOption({ label: 'Canada · Study Permit' });
    await d.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/leads\//);
    await page.getByRole('button', { name: 'Convert to client →' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
    await page.waitForURL(/\/cases\//);
    caseUrl = page.url();
    await page.getByRole('link', { name: 'Priya Raman' }).first().click();
    await page.waitForURL(/\/clients\//);
    clientUrl = page.url().split('?')[0]!;
  });

  test('Canada CRS: live score from IELTS bands, saved with an explanation', async () => {
    await page.goto(`${clientUrl}?tab=eligibility`);
    await expect(page.getByText('Pre-filled from the profile')).toBeVisible();
    await page.getByLabel('Age', { exact: true }).fill('29');
    await page.getByLabel('Education', { exact: true }).selectOption('master');
    await page.getByLabel('English test').selectOption('IELTS');
    await page.getByLabel('IELTS bands l').fill('8');
    for (const k of ['r', 'w', 's']) await page.getByLabel(`IELTS bands ${k}`).fill('7');
    await expect(page.getByText('= CLB 9 / 9 / 9 / 9')).toBeVisible();
    await page.getByLabel('Skilled work outside Canada (years)').fill('3');
    await expect(page.getByTestId('score')).toHaveText('469'); // 110 + 135 + 124 + 100 (worked example)
    await expect(page.getByText('Provincial nomination (PNP)')).toBeVisible();

    await page.getByRole('button', { name: 'Save & explain' }).click();
    await expect(page.getByText('Saved with an explanation')).toBeVisible();
    await expect(page.getByText(/Canada CRS · 469/)).toBeVisible();
    await expect(page.getByText(/CRS score 469 of 1,200/)).toBeVisible();
  });

  test('Australia points: pass mark, nomination, saved', async () => {
    await page.getByRole('tab', { name: 'Australia · Points test' }).click();
    await page.getByLabel('Age', { exact: true }).fill('31');
    await page.getByLabel('English', { exact: true }).selectOption('superior');
    await page.getByLabel('Skilled work outside Australia (last 10 years)').fill('6');
    await page.getByLabel('Highest qualification').selectOption('bachelor');
    await page.getByLabel('Partner', { exact: true }).selectOption('single');
    await expect(page.getByTestId('score')).toHaveText('85');
    await expect(page.getByText('Meets pass mark 65')).toBeVisible();
    await page.getByLabel('Nomination', { exact: true }).selectOption('190');
    await expect(page.getByTestId('score')).toHaveText('90');
    await page.getByRole('button', { name: 'Save & explain' }).click();
    await expect(page.getByText(/Australia points · 90/)).toBeVisible();
  });

  test('AI document check flags the wrong file, and passes the right one', async () => {
    await page.goto(caseUrl);
    await page.getByLabel('Upload Passport (all pages)').setInputFiles(pdf('HDFC_bank_statement.pdf'));
    const row = page.locator('li', { hasText: 'Passport (all pages)' }).first();
    await expect(row.getByText(/Yu: 1 issue · This looks like a bank or financial statement/)).toBeVisible({ timeout: 20_000 });

    await row.getByRole('button', { name: 'Review' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('region', { name: 'Yu check' })).toContainText('Sandbox: judged from the file name and size only');
    await page.keyboard.press('Escape');

    await page.getByLabel('Upload Passport (all pages)').setInputFiles(pdf('passport-all-pages.pdf'));
    await expect(page.locator('li', { hasText: 'Passport (all pages)' }).first().getByText('Yu: looks right')).toBeVisible({ timeout: 20_000 });
  });

  test('document checks can be switched off', async () => {
    await page.goto(`/${slug}/settings?tab=integrations`);
    await page.getByLabel('Check uploaded documents').uncheck();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.goto(caseUrl);
    await page.getByLabel('Upload Bank statements / education loan sanction').setInputFiles(pdf('passport-scan.pdf'));
    const row = page.locator('li', { hasText: 'Bank statements / education loan' }).first();
    await expect(row.getByText('passport-scan.pdf')).toBeVisible();
    await page.waitForTimeout(2000);
    await page.reload();
    await expect(page.locator('li', { hasText: 'Bank statements / education loan' }).first().getByText(/AI:/)).toHaveCount(0);
  });

  test('no browser console errors', async () => {
    expect(consoleErrors).toEqual([]);
  });
});
