import { expect, test } from '@playwright/test';

// Password fields: show/hide toggle, and sign-up asks for the password twice.

const run = Date.now().toString(36);

test('sign-up refuses mismatched passwords; the eye shows and hides what was typed', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Owner Pw');
  await page.getByLabel('Work email').fill(`pw-${run}@example.test`);
  const pw = page.getByLabel('Password', { exact: true });
  await pw.fill('kicko-pass-123');
  await expect(pw).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).first().click();
  await expect(pw).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).first().click();
  await expect(pw).toHaveAttribute('type', 'password');

  await page.getByLabel('Confirm password').fill('kicko-pass-124');
  await page.getByLabel('Agency name').fill(`Pw Agency ${run}`);
  await page.getByLabel('Workspace address').fill(`pw-${run}`);
  await page.getByRole('button', { name: 'Create account & workspace' }).click();
  await expect(page.getByText('The passwords don’t match').first()).toBeVisible();
  await expect(page).toHaveURL(/\/signup/);

  await page.getByLabel('Confirm password').fill('kicko-pass-123');
  await page.getByRole('button', { name: 'Create account & workspace' }).click();
  await page.waitForURL(`**/pw-${run}`);
});

test('sign-in has the show-password toggle too', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill('secret-123');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
});
