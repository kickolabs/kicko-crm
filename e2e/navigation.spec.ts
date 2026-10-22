import { expect, test } from '@playwright/test';

// Pages outside the workspace shell always offer a way back.

const run = Date.now().toString(36);
const slug = `nav-${run}`;

test('switch workspace, new agency, my account and checkout all lead back', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Owner Nav');
  await page.getByLabel('Work email').fill(`nav-${run}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
  await page.getByLabel('Confirm password').fill('kicko-pass-123');
  await page.getByLabel('Agency name').fill(`Nav Agency ${run}`);
  await page.getByLabel('Workspace address').fill(slug);
  await page.getByRole('button', { name: 'Create account & workspace' }).click();
  await page.waitForURL(`**/${slug}`);

  const menu = async (item: string) => {
    await page.getByRole('button', { name: 'Account: Owner Nav' }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  const back = page.getByRole('link', { name: `← Back to Nav Agency ${run}` });

  await menu('Switch workspace');
  await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
  await back.click();
  await page.waitForURL(`**/${slug}`);

  await menu('New agency workspace');
  await expect(page.getByRole('heading', { name: 'Add another agency.' })).toBeVisible();
  await back.click();
  await page.waitForURL(`**/${slug}`);

  await menu('My account & security');
  await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
  await back.click();
  await page.waitForURL(`**/${slug}`);

  await page.goto(`/${slug}/settings?tab=plan`);
  await page.getByRole('button', { name: 'Choose Growth' }).click();
  await page.waitForURL(/\/checkout\/sandbox/);
  await page.getByRole('link', { name: 'Cancel and go back' }).click();
  await page.waitForURL(`**/${slug}/settings?tab=plan`);
});
