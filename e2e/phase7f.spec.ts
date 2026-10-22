import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';
import { formatMoney } from '../apps/web/src/lib/money';
import { PLANS } from '../apps/web/src/lib/plans';
import { testMobile, verifyMobile } from './helpers';

// Phase 7f: the public website (home, pricing, SEO files) and onboarding for a
// new agency (Get started checklist, sample leads).

const run = Date.now().toString(36);
const slug = `p7f-${run}`;
const DB = 'postgresql://postgres:postgres@localhost:5433/kicko';

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const db = new Pg(DB);
  await db.connect();
  try {
    return (await db.query(sql, params)).rows as T[];
  } finally {
    await db.end();
  }
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('Phase 7f · website', () => {
  test('home page: product story, links to pricing and sign-up, FAQ', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Every enquiry, case and deadline.');
    await expect(page.getByRole('heading', { name: 'One journey, not six spreadsheets.' })).toBeVisible();
    await expect(page.getByText(`From ${formatMoney(PLANS.starter.price.INR.year, 'INR')} per user a month.`)).toBeVisible();
    await page.getByText('Where is our data stored?').click();
    await expect(page.getByText(/In India \(Mumbai\) wherever our providers offer it/)).toBeVisible();
    await page.getByRole('link', { name: /Start your 14-day free trial/ }).click();
    await page.waitForURL('**/signup');
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Pricing' }).click();
    await page.waitForURL('**/pricing');
  });

  test('pricing page follows the plans the app bills from', async ({ page }) => {
    await page.goto('/pricing');
    const growth = page.getByRole('region', { name: 'Growth plan' });
    await expect(growth).toContainText(formatMoney(PLANS.growth.price.INR.year, 'INR'));
    await expect(growth).toContainText(`${PLANS.growth.creditsPerUser} AI credits per user each month`);
    await expect(page.getByRole('region', { name: 'Starter plan' })).not.toContainText('AI credits');
    await page.getByLabel('Users').fill('3');
    await expect(growth.getByLabel('Growth total')).toContainText('3 users:');
    await page.getByRole('tab', { name: 'Monthly' }).click();
    await expect(growth).toContainText(formatMoney(PLANS.growth.price.INR.month, 'INR'));
    await page.getByRole('tab', { name: '$ USD' }).click();
    await expect(growth).toContainText(formatMoney(PLANS.growth.price.USD.month, 'USD'));
    const row = page.getByRole('row', { name: /AI voice agent/ });
    await expect(row.getByLabel('Included')).toHaveCount(1); // Pro only
    await expect(page.getByText('Founding agencies: 30% off.')).toBeVisible();
  });

  test('works on a phone without sideways scrolling', async ({ browser }) => {
    // 360px as well as 390px: text renders slightly wider on Linux than Windows,
    // so a page that only just fits at 390 here can overflow on CI or a real phone.
    for (const width of [390, 360]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      for (const path of ['/', '/pricing']) {
        await page.goto(path);
        expect(await noSideScroll(page), `${path} at ${width}px`).toBe(true);
      }
      await page.close();
    }
  });

  test('search engines see the website, not workspaces', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Allow: /pricing');
    expect(robots).toContain('Disallow: /');
    expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('/pricing</loc>');
    expect(sitemap).not.toContain('/demo');
    const og = await request.get('/opengraph-image');
    expect(og.headers()['content-type']).toBe('image/png');
  });
});

test.describe.serial('Phase 7f · onboarding', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Owner Onboard');
    await page.getByLabel('Work email').fill(`p7f-${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await page.getByLabel('Confirm password').fill('kicko-pass-123');
    await page.getByLabel('Mobile number').fill(testMobile());
    await page.getByLabel('Agency name').fill(`Onboard Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await verifyMobile(page);
    await page.waitForURL(`**/${slug}`);
  });

  test('a new agency sees the Get started checklist', async () => {
    const card = page.getByRole('region', { name: 'Get started' });
    await expect(card).toContainText('0 of 7 done');
    await expect(card.getByRole('link', { name: /Bring in your leads/ })).toHaveAttribute('href', `/${slug}/import`);
  });

  test('sample leads fill the CRM and come out again with one click', async () => {
    const card = page.getByRole('region', { name: 'Get started' });
    await card.getByRole('button', { name: 'Try with sample leads' }).click();
    await expect(card.getByText('Sample leads are in your workspace.')).toBeVisible();
    const count = async () => (await q<{ n: number }>(`SELECT count(*)::int AS n FROM "Lead" WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = $1)`, [slug]))[0]!.n;
    expect(await count()).toBe(12);
    await expect(card).toContainText('0 of 7 done'); // sample leads don't count as bringing in your own
    await page.goto(`/${slug}/reports?r=lead-sources&p=all`);
    await expect(page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Total', exact: true }) })).toContainText('of 12');
    await page.goto(`/${slug}`);
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('region', { name: 'Get started' }).getByRole('button', { name: 'Remove sample leads' }).click();
    await expect(page.getByRole('region', { name: 'Get started' }).getByRole('button', { name: 'Try with sample leads' })).toBeVisible();
    expect(await count()).toBe(0);
  });

  test('steps tick themselves off; the checklist can be hidden', async () => {
    await page.goto(`/${slug}/settings?tab=team`);
    await page.getByLabel('Email').fill(`p7f-team-${run}@example.test`);
    await page.getByRole('button', { name: 'Create invite' }).click();
    await expect(page.getByLabel('Invite link')).toBeVisible();
    await page.goto(`/${slug}`);
    const card = page.getByRole('region', { name: 'Get started' });
    await expect(card).toContainText('1 of 7 done');
    await expect(card.getByRole('link', { name: /Done:\s*Invite your team/ })).toBeVisible();
    page.once('dialog', (d) => void d.accept());
    await card.getByRole('button', { name: 'Hide' }).click();
    await expect(page.getByRole('region', { name: 'Get started' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Get started' })).toHaveCount(0);
  });
});
