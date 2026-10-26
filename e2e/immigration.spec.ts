import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';
import { testMobile, verifyMobile } from './helpers';

// The immigration pack end to end: a pathway from the library, a lead with destination →
// pathway (which resets when the country changes) and occupation, conversion carrying it
// all over, a professional profile, an employer with a vacancy, matching, and a hire that
// puts the offer on the case. Needs the library loaded (npm run library:import).

const run = Date.now().toString(36);
const owner = { name: 'Isha Owner', email: `imm-${run}@example.test`, password: 'kicko-pass-123' };
const agency = { name: `Gulf Bridge ${run}`, slug: `gulf-${run}` };
const PATHWAY = 'UAE employer-sponsored work visa';

test.describe.serial('Immigration pack journey', () => {
  let page: Page;
  let caseUrl = '';

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/signup');
    await page.getByLabel('Your name').fill(owner.name);
    await page.getByLabel('Work email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByLabel('Confirm password').fill(owner.password);
    await page.getByLabel('Mobile number').fill(testMobile());
    await page.getByLabel('Agency name').fill(agency.name);
    await page.getByLabel('Workspace address').fill(agency.slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await verifyMobile(page);
    await page.waitForURL(`**/${agency.slug}`);
  });

  test.afterAll(() => page.close());

  test('adds a pathway from the library, with its official info', async () => {
    await page.goto(`/${agency.slug}/settings?tab=workflows`);
    await page.getByLabel('Country').first().selectOption('AE');
    await page.getByRole('button', { name: 'Show pathways' }).click();
    await page.waitForURL(/country=AE/);
    const row = page.getByRole('listitem').filter({ hasText: PATHWAY }).first();
    await expect(row.getByText('Eligibility, steps & fees').first()).toBeVisible();
    await row.getByRole('button', { name: /Add$/ }).click();
    await expect(row.getByRole('link', { name: 'Added · Edit' })).toBeVisible();
  });

  test('lead: country → pathway; changing the country clears a pathway that no longer fits', async () => {
    await page.goto(`/${agency.slug}/leads`);
    await page.getByRole('button', { name: 'New lead' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('First name').fill('Karthik');
    await d.getByLabel('Last name').fill('Selvam');
    await d.getByLabel('Phone / WhatsApp').fill('98400 55667');
    await d.getByLabel('Country', { exact: true }).selectOption('AE');
    await d.getByLabel('Interested in', { exact: true }).selectOption('WORK');
    await d.getByLabel('Visa product').selectOption({ label: `United Arab Emirates · ${PATHWAY}` });
    await expect(d.getByLabel('Pathway information')).toBeVisible();
    await d.getByLabel('Country', { exact: true }).selectOption('DE');
    await expect(d.getByLabel('Visa product')).toHaveValue('');
    await expect(d.getByLabel('Visa product').getByRole('option', { name: 'Germany · EU Blue Card' })).toBeAttached();
    await d.getByLabel('Country', { exact: true }).selectOption('HR');
    await expect(d.getByText(/No visa workflow for Croatia \(Work\) yet/)).toBeVisible();
    await d.getByLabel('Country', { exact: true }).selectOption('AE');
    await d.getByLabel('Visa product').selectOption({ label: `United Arab Emirates · ${PATHWAY}` });
    await d.getByLabel('Occupation').selectOption('truck_driver');
    await d.getByLabel('Work experience (years)').fill('6');
    await d.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/leads\/[a-z0-9]+$/);
    await expect(page.getByText('Heavy truck and lorry driver')).toBeVisible();
  });

  test('conversion carries the destination and profile over, and opens the case', async () => {
    await page.getByRole('button', { name: 'Convert to client →' }).click();
    const d = page.getByRole('dialog');
    await expect(d.getByText('Carried over to the client')).toBeVisible();
    await expect(d.getByText('Heavy truck and lorry driver')).toBeVisible();
    await d.getByRole('button', { name: 'Convert' }).click();
    await page.waitForURL(/\/cases\/[a-z0-9]+$/);
    caseUrl = page.url();
    await expect(page.getByText(/KCK-AE-\d+/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'About this pathway' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Next action' })).toBeVisible();
  });

  test('professional profile: occupation came across; add a driving licence', async () => {
    await page.getByRole('link', { name: 'Karthik Selvam' }).first().click();
    await page.waitForURL(/\/clients\//);
    await page.getByRole('tab', { name: 'profession' }).click();
    await expect(page.getByLabel('Occupation')).toHaveValue('truck_driver');
    await expect(page.getByLabel('Work experience (years)')).toHaveValue('6');
    await page.getByRole('button', { name: /Add licence/ }).click();
    await page.getByLabel('Licences & registrations 1: Type').selectOption('Driving licence');
    await page.getByLabel('Licences & registrations 1: Category / class').fill('HMV');
    await page.getByLabel('Licences & registrations 1: Valid until').fill('2031-12-31');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
  });

  test('portal logins are encrypted, and viewing a password is audited', async () => {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Portal', { exact: true }).fill('IRCC / GCKey');
    await d.getByLabel('Username or email').fill('karthik.gckey');
    await d.getByLabel('Password').fill('S3cret-Pass!');
    await d.getByRole('button', { name: 'Save' }).click();
    await expect(d).toBeHidden();
    const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Portal logins' }) });
    await expect(card.getByText('karthik.gckey')).toBeVisible();
    await expect(card.getByText('S3cret-Pass!')).toHaveCount(0);
    await card.getByRole('button', { name: 'Show password' }).click();
    await expect(card.getByText('S3cret-Pass!')).toBeVisible();
    const db = new Pg('postgresql://postgres:postgres@localhost:5433/kicko');
    await db.connect();
    try {
      const { rows } = await db.query(
        `SELECT v.secret, (SELECT count(*)::int FROM "AuditEvent" a WHERE a."tenantId" = v."tenantId" AND a.action = 'document.vault_revealed') AS reveals,
                (SELECT count(*)::int FROM "AuditEvent" a WHERE a."tenantId" = v."tenantId" AND (a.summary LIKE '%S3cret%' OR a.details::text LIKE '%S3cret%')) AS leaks
         FROM "CredentialVault" v JOIN "Tenant" t ON t.id = v."tenantId" WHERE t.slug = $1`,
        [agency.slug],
      );
      expect(rows[0].secret).toMatch(/^v1\./);
      expect(rows[0].secret).not.toContain('S3cret');
      expect(rows[0]).toMatchObject({ reveals: 1, leaks: 0 });
    } finally {
      await db.end();
    }
  });

  test('employer, vacancy, a suggested match, shortlist and hire: the offer lands on the case', async () => {
    await page.getByRole('link', { name: 'Employers' }).first().click();
    await page.getByRole('button', { name: 'New employer' }).click();
    let d = page.getByRole('dialog');
    await d.getByLabel('Employer name').fill('Gulf Freight LLC');
    await d.getByLabel('Country').selectOption('AE');
    await d.getByRole('button', { name: 'Add employer' }).click();
    await page.waitForURL(/\/organizations\/[a-z0-9]+$/);

    await page.getByRole('button', { name: 'New vacancy' }).click();
    d = page.getByRole('dialog');
    await d.getByLabel('Role').fill('Heavy truck driver');
    await d.getByLabel('Occupation').selectOption('truck_driver');
    await d.getByLabel('Country').selectOption('AE');
    await d.getByLabel('Visa workflow').selectOption({ label: `United Arab Emirates · ${PATHWAY}` });
    await d.getByLabel('Positions').fill('2');
    await d.getByLabel('Minimum experience (years)').fill('3');
    await d.getByLabel('Licences needed').fill('HMV');
    await d.getByLabel('Salary from').fill('4000');
    await d.getByLabel('Currency').fill('AED');
    await d.getByRole('button', { name: 'Add vacancy' }).click();
    await page.waitForURL(/\/organizations\/openings\/[a-z0-9]+$/);

    const suggested = page.getByRole('listitem').filter({ hasText: 'Karthik Selvam' });
    await expect(suggested.getByText(/\d+% fit/)).toBeVisible();
    await expect(suggested.getByText('Holds the licences needed')).toBeVisible();
    await suggested.getByRole('button', { name: /Shortlist$/ }).click();
    const candidate = page.getByRole('listitem').filter({ hasText: 'Karthik Selvam' }).filter({ has: page.getByLabel('Candidate stage') });
    await candidate.getByLabel('Candidate stage').selectOption('hired');
    await expect.poll(async () => {
      await page.goto(caseUrl);
      return page.getByRole('heading', { name: 'Employer & job offer' }).isVisible();
    }).toBe(true);
    await expect(page.getByRole('link', { name: 'Gulf Freight LLC' })).toBeVisible();
    await expect(page.getByText('AED 4,000').first()).toBeVisible();
  });

  test('a retainer agreement is created from the case and signed by the client in the portal', async ({ browser }) => {
    await page.goto(caseUrl);
    const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Agreements & letters' }) });
    await card.getByRole('listitem').filter({ hasText: 'Retainer agreement' }).getByRole('button', { name: 'Send to sign' }).click();
    await expect(card.getByText(/Retainer agreement created/)).toBeVisible();

    await page.getByRole('link', { name: 'Karthik Selvam' }).first().click();
    await page.waitForURL(/\/clients\//);
    await page.getByRole('button', { name: 'Create portal link' }).click();
    const link = await page.getByLabel('Portal link').inputValue();

    const ctx = await browser.newContext();
    const client = await ctx.newPage();
    try {
      await client.goto(link);
      await client.getByRole('button', { name: 'Open my portal' }).click();
      await client.waitForURL(`**/portal/${agency.slug}`);
      await client.getByRole('button', { name: 'Read & sign' }).click();
      const d = client.getByRole('dialog');
      await expect(d.getByRole('heading', { name: 'Retainer agreement' }).first()).toBeVisible();
      await expect(d.getByText(agency.name).first()).toBeVisible();
      await d.getByLabel('Type your full name to sign').fill('Karthik Selvam');
      await d.getByRole('button', { name: 'Sign' }).click();
      await expect(d.getByText('Tick the box to confirm').first()).toBeVisible(); // the checkbox is required
      await d.getByLabel(/I have read this document/).check();
      await d.getByRole('button', { name: 'Sign' }).click();
      await expect(d).toBeHidden();
      await expect(client.getByRole('button', { name: 'Read & sign' })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
    const db = new Pg('postgresql://postgres:postgres@localhost:5433/kicko');
    await db.connect();
    try {
      const { rows } = await db.query(
        `SELECT d.signature, (SELECT count(*)::int FROM "DocumentFile" f WHERE f."documentId" = d.id) AS files,
                (SELECT count(*)::int FROM "AuditEvent" a WHERE a."tenantId" = d."tenantId" AND a.action = 'document.signed') AS audited
         FROM "Document" d JOIN "Tenant" t ON t.id = d."tenantId" WHERE t.slug = $1 AND d.name = 'Retainer agreement'`,
        [agency.slug],
      );
      expect(rows[0].signature).toMatchObject({ name: 'Karthik Selvam', hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(rows[0]).toMatchObject({ files: 2, audited: 1 });
    } finally {
      await db.end();
    }
  });
});
