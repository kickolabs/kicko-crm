import { test } from '@playwright/test';

// Full-page screenshots of the demo workspace for design review.
// Requires `npm run db:seed:demo`. Run: npx playwright test visual
test('capture demo screens', async ({ page }) => {
  test.skip(!process.env.VISUAL, 'Set VISUAL=1 to capture screenshots');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login');
  await page.getByLabel('Work email').fill('demo@kicko.app');
  await page.getByLabel('Password', { exact: true }).fill('demo-pass-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/demo');

  for (const [name, path] of [
    ['dashboard', '/demo'],
    ['leads', '/demo/leads'],
    ['walk-ins', '/demo/walk-ins'],
    ['billing', '/demo/billing'],
    ['partners', '/demo/partners'],
    ['documents', '/demo/documents'],
    ['whatsapp-settings', '/demo/settings?tab=whatsapp'],
  ]) {
    await page.goto(path!);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `test-results/visual/${name}.png`, fullPage: true });
  }
  await page.goto('/demo/cases');
  await page.getByRole('link', { name: 'Priya Raman' }).click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/visual/case.png', fullPage: true });

  await page.goto('/demo/billing');
  await page.getByRole('link', { name: /^HO\// }).first().click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/visual/invoice.png', fullPage: true });
  const pdf = await page.request.get(await page.getByRole('link', { name: 'PDF', exact: true }).getAttribute('href') as string);
  const fs = await import('node:fs/promises');
  await fs.writeFile('test-results/visual/invoice.pdf', await pdf.body());

  // Staff inbox, then the client's own view of the portal (via a fresh staff-made link).
  await page.goto('/demo/inbox');
  await page.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: /Karthik/ }).click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/visual/inbox.png', fullPage: true });
  await page.goto('/demo/clients');
  await page.getByRole('link', { name: 'Priya Raman' }).click();
  await page.getByRole('button', { name: 'Create portal link' }).click();
  const link = await page.getByLabel('Portal link').inputValue();
  const clientCtx = await page.context().browser()!.newContext({ viewport: { width: 1280, height: 900 } });
  const client = await clientCtx.newPage();
  await client.goto(link);
  await client.getByRole('button', { name: 'Open my portal' }).click();
  await client.waitForURL(/\/portal\/demo$/);
  await client.screenshot({ path: 'test-results/visual/portal.png', fullPage: true });
  await client.setViewportSize({ width: 390, height: 844 });
  await client.screenshot({ path: 'test-results/visual/portal-mobile.png', fullPage: true });
  await clientCtx.close();
});
