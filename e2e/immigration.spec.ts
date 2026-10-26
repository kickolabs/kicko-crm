import { expect, test, type Page } from '@playwright/test';
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
});
