import { expect, test } from '@playwright/test';
import { testMobile, verifyMobile } from './helpers';

// Dashboard stage flow: leads and cases in common phases, filters, and links to the lists.

const run = Date.now().toString(36);
const slug = `sf-${run}`;

test('a converted lead shows as a case preparing; filters and links work', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Owner Flow');
  await page.getByLabel('Work email').fill(`sf-${run}@example.test`);
  await page.getByLabel('Mobile number').fill(testMobile());
  await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
  await page.getByLabel('Confirm password').fill('kicko-pass-123');
  await page.getByLabel('Agency name').fill(`Flow Agency ${run}`);
  await page.getByLabel('Workspace address').fill(slug);
  await page.getByRole('button', { name: 'Create account & workspace' }).click();
  await verifyMobile(page);
  await page.waitForURL(`**/${slug}`);

  await page.goto(`/${slug}/leads?new=1`);
  const d = page.getByRole('dialog');
  await d.getByLabel('First name').fill('Ravi');
  await d.getByLabel('Phone / WhatsApp').fill('9840033445');
  await d.getByLabel('Visa product').selectOption({ label: 'Canada · Study Permit' });
  await d.getByRole('button', { name: 'Create lead' }).click();
  await page.waitForURL(/\/leads\//);
  await page.getByRole('button', { name: 'Convert to client →' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
  await page.waitForURL(/\/cases\//);

  await page.goto(`/${slug}`);
  const flow = page.getByRole('region', { name: 'Stage flow' });
  const row = (label: string) => flow.getByRole('link', { name: label, exact: true });
  await expect(row('Preparing').locator('xpath=following-sibling::span[1]')).toHaveText('1');
  await expect(flow.getByText('Study 100%')).toBeVisible();

  await flow.getByLabel('Visa type').selectOption('PR');
  await page.waitForURL(/flowType=PR/);
  await expect(page.getByRole('region', { name: 'Stage flow' }).getByRole('link', { name: 'Preparing', exact: true }).locator('xpath=following-sibling::span[1]')).toHaveText('0');

  await page.goto(`/${slug}`);
  await row('Preparing').click();
  await page.waitForURL(/\/cases\?.*phase=preparing/);
  await expect(page.getByText('Preparing: not yet lodged')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ravi' }).first()).toBeVisible();
});
