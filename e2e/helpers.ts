import { expect, type Page } from '@playwright/test';

// Sign-up now verifies the owner's mobile before the free trial starts. In the OTP
// sandbox the verify page shows the code, so tests read it from the screen.

/** A fresh Indian mobile number (one trial per number). */
export const testMobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

/** After "Create account & workspace": enter the sandbox code, which starts the trial. */
export async function verifyMobile(page: Page) {
  await page.waitForURL(/\/verify-mobile/, { timeout: 30_000 });
  const hint = page.getByText(/Your code is \d{6}/);
  await expect(hint).toBeVisible();
  const code = (await hint.textContent())!.match(/\d{6}/)![0];
  // Type only once the page is interactive (the fingerprint field fills in after hydration);
  // a value typed earlier can be lost when React takes over the form.
  await expect(page.locator('input[name="fp"]')).not.toHaveValue('');
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Verify & start free trial' }).click();
}
