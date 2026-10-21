import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Opens every main screen of the seeded demo workspace (realistic data on every
// page) and fails on any browser console error, e.g. React key or hydration warnings.
// Needs the demo seed: `npm run db:seed`.

const PAGES = [
  '', '/inbox', '/calls', '/leads', '/leads?view=table', '/clients', '/cases', '/documents', '/tasks', '/tasks?scope=all', '/tasks?show=done',
  '/calendar', '/walk-ins', '/billing', '/partners', '/partners/commissions', '/import', '/reports', '/reports?r=counsellors', '/reports?r=approvals', '/reports?r=collections',
  ...['general', 'team', 'billing', 'portal', 'whatsapp', 'assistant', 'calling', 'voice', 'integrations', 'plan', 'fields', 'security', 'capture', 'workflows'].map((t) => `/settings?tab=${t}`),
];

/**
 * Wait until React has finished hydrating: network idle, then the main thread idle.
 * Leaving a page mid-hydration (only possible in a fast test under load) aborts it
 * with a spurious hydration error that real users never see.
 */
async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
  for (let i = 0; i < 2; i++) await page.evaluate(() => new Promise<void>((r) => requestIdleCallback(() => r(), { timeout: 3000 })));
}

test('no console errors on any demo screen', async ({ page }, info) => {
  test.setTimeout(240_000);
  // Record DOM nodes removed early on: after a hydration mismatch React re-renders that subtree.
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __removed: string[] }).__removed = log;
    const t0 = Date.now();
    new MutationObserver((list) => {
      if (Date.now() - t0 > 8000) return;
      for (const m of list) m.removedNodes.forEach((n) => n instanceof Element && log.push(n.outerHTML.slice(0, 400)));
    }).observe(document, { childList: true, subtree: true });
  });

  const errors: string[] = [];
  let current = '/login';
  let hydrationError = false;
  page.on('console', (m) => {
    if (m.type() !== 'error' || /favicon|Failed to load resource/.test(m.text())) return;
    errors.push(`${current}: ${m.text().slice(0, 300)}`);
    if (/418|hydrat/i.test(m.text())) hydrationError = true;
  });
  page.on('pageerror', (e) => errors.push(`${current}: ${e.message}`));

  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@kicko.app');
  await page.getByLabel('Password').fill('demo-pass-123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/demo', { timeout: 30_000 }).catch(() => test.skip(true, 'Demo workspace not seeded'));

  const visit = async (url: string) => {
    current = url;
    hydrationError = false;
    await page.goto(url);
    await settled(page);
    if (hydrationError) {
      // Keep evidence: the final DOM and what React replaced.
      writeFileSync(info.outputPath('client.html'), await page.content());
      const removed = await page.evaluate(() => (window as unknown as { __removed: string[] }).__removed.slice(0, 12));
      writeFileSync(info.outputPath('removed.txt'), removed.join('\n\n'));
    }
  };

  for (const path of PAGES) await visit(`/demo${path}`);
  // One detail page of each kind.
  for (const list of ['/leads?view=table', '/clients', '/cases', '/billing', '/calls']) {
    await visit(`/demo${list}`);
    const href = await page.locator(`main a[href^="/demo${list.split('?')[0]}/"]`).first().getAttribute('href').catch(() => null);
    if (href) await visit(href);
  }
  expect(errors).toEqual([]);
});
