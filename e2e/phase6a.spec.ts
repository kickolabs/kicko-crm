import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { testMobile, verifyMobile } from './helpers';

// Phase 6a: sub-agent network. Agency adds a sub-agent → partner signs in with a
// one-time link → refers a client (duplicates protected) → staff converts and
// takes a payment → commission accrues (ex-GST) → payout → partner sees it paid.

const run = Date.now().toString(36);
const slug = `p6a-${run}`;

test.describe.serial('Phase 6a · sub-agent network', () => {
  let staff: Page;
  let partner: Page;
  let partnerCtx: BrowserContext;
  let agentUrl = '';
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    staff = await browser.newPage();
    partnerCtx = await browser.newContext();
    partner = await partnerCtx.newPage();
    for (const pg of [staff, partner]) {
      pg.on('console', (m) => {
        if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
      });
    }
    await staff.goto('/signup');
    await staff.getByLabel('Your name').fill('Owner Six');
    await staff.getByLabel('Work email').fill(`p6a-${run}@example.test`);
    await staff.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await staff.getByLabel('Confirm password').fill('kicko-pass-123');
    await staff.getByLabel('Mobile number').fill(testMobile());
    await staff.getByLabel('Agency name').fill(`Network Agency ${run}`);
    await staff.getByLabel('Workspace address').fill(slug);
    await staff.getByRole('button', { name: 'Create account & workspace' }).click();
    await verifyMobile(staff);
    await staff.waitForURL(`**/${slug}`);
  });

  test('agency adds a sub-agent and creates their portal link', async () => {
    await staff.goto(`/${slug}/partners`);
    await staff.getByRole('link', { name: 'Sub-agents' }).click();
    await staff.getByRole('button', { name: '+ Sub-agent' }).click();
    const d = staff.getByRole('dialog');
    await d.getByLabel('Contact name').fill('Ravi Kumar');
    await d.getByLabel('Company').fill('Kumar Overseas');
    await d.getByLabel('Email (their portal login)').fill(`ravi-${run}@agent.test`);
    await d.getByLabel('City').fill('Coimbatore');
    await d.getByLabel('Percentage').fill('10');
    await d.getByRole('button', { name: 'Add sub-agent' }).click();
    await staff.waitForURL(/\/partners\/agents\/[a-z0-9]+$/);
    agentUrl = staff.url();
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Ravi Kumar');
    await expect(staff.getByText('10% of payments').first()).toBeVisible();

    await staff.getByRole('button', { name: 'Create portal link' }).click();
    const link = await staff.getByLabel('Partner portal link').inputValue();
    expect(link).toContain(`/partner/${slug}/auth?t=`);

    await partner.goto(link);
    await partner.getByRole('button', { name: 'Open partner portal' }).click();
    await partner.waitForURL(`**/partner/${slug}`);
    await expect(partner.getByText(/Partner portal · Ravi Kumar, Kumar Overseas/)).toBeVisible();
  });

  test('partner refers a client; duplicates and missing consent are refused', async () => {
    const form = partner.locator('form', { hasText: 'Refer client' });
    await form.getByLabel('First name').fill('Anjali');
    await form.getByLabel('Last name').fill('Menon');
    await form.getByLabel('Phone (WhatsApp)').fill('9840099001');
    await form.getByLabel('Destination').selectOption('CA');
    await form.getByLabel('Looking to').selectOption('STUDY');
    await form.getByRole('button', { name: 'Refer client' }).click();
    await expect(partner.getByText('Confirm the client agreed to be contacted')).toBeVisible();

    await form.getByLabel('The client agreed to be contacted by the agency.').check();
    await form.getByRole('button', { name: 'Refer client' }).click();
    await expect(partner.getByText(/Thanks! Referral L-\d+ received/)).toBeVisible().catch(async (e) => {
      console.log('PARTNER PAGE:', (await partner.locator('main').innerText()).slice(0, 1500));
      throw e;
    });
    await expect(partner.getByRole('listitem').filter({ hasText: 'Anjali Menon' })).toContainText('New');

    // Same phone again (another agent could try this too): not reassigned.
    await form.getByLabel('First name').fill('Anjali');
    await form.getByLabel('Phone (WhatsApp)').fill('+91 98400 99001');
    await form.getByLabel('The client agreed to be contacted by the agency.').check();
    await form.getByRole('button', { name: 'Refer client' }).click();
    await expect(partner.getByText(/already registered with the agency/)).toBeVisible();
  });

  test('a partner session cannot open the staff app', async () => {
    await partner.goto(`/${slug}/leads`);
    await expect(partner).toHaveURL(/\/login/);
  });

  test('staff converts, takes a payment, commission accrues before GST and is paid out', async () => {
    await staff.goto(`/${slug}/leads?view=table`);
    await staff.getByRole('link', { name: 'Anjali Menon' }).click();
    await staff.waitForURL(/\/leads\/[a-z0-9]+$/);
    await expect(staff.locator('dd', { hasText: /^Sub-agent$/ })).toBeVisible(); // source
    await expect(staff.getByLabel('Referred by sub-agent')).toHaveValue(/.+/);
    await expect(staff.getByText(/Referred by sub-agent Ravi Kumar/)).toBeVisible(); // timeline
    await expect(staff.getByText(/also referred this lead/)).toBeVisible(); // the duplicate attempt is visible to staff

    await staff.getByRole('button', { name: 'Convert to client →' }).click();
    await staff.getByRole('dialog').getByLabel('Open a case for').selectOption({ label: 'Canada · Study Permit' });
    await staff.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
    await staff.waitForURL(/\/cases\//);
    const caseUrl = staff.url();

    await staff.goto(`/${slug}/settings?tab=billing`);
    await staff.getByRole('button', { name: '+ Package' }).click();
    const pk = staff.getByRole('dialog');
    await pk.getByLabel('Name').fill('Canada study: full service');
    await pk.getByLabel('Price before tax (₹)').fill('50000');
    await pk.getByRole('button', { name: 'Save package' }).click();
    await expect(staff.getByText('₹50,000')).toBeVisible();

    await staff.goto(caseUrl);
    await staff.getByRole('link', { name: '+ Invoice' }).click();
    await staff.waitForURL(/billing\/new/);
    await staff.getByRole('button', { name: /Canada study: full service/ }).click();
    await staff.getByRole('button', { name: 'Create & issue invoice' }).click();
    await staff.waitForURL(/\/billing\/[a-z0-9]+$/);
    await staff.getByRole('button', { name: 'Record payment' }).click();
    await staff.getByRole('dialog').getByLabel('Amount (₹)').fill('29500');
    await staff.getByRole('dialog').getByRole('button', { name: 'Record & issue receipt' }).click();
    await expect(staff.getByText('Part paid')).toBeVisible();

    // ₹29,500 includes 18% GST → ₹25,000 before tax → 10% = ₹2,500.
    await staff.goto(agentUrl);
    await expect(staff.getByText('Share of ₹25,000 (before GST)')).toBeVisible();
    await staff.getByLabel('Payment reference (UTR / cheque no.)').fill('UTR998877');
    await staff.getByRole('button', { name: 'Mark ₹2,500 as paid' }).click();
    await expect(staff.getByText(/paid \(UTR998877\)/)).toBeVisible();
  });

  test('partner sees the client progress and the paid commission', async () => {
    await partner.goto(`/partner/${slug}`);
    const row = partner.getByRole('listitem').filter({ hasText: 'Anjali Menon' }).first(); // referrals list
    await expect(row).toContainText('Client · case open');
    await expect(row).toContainText('Canada Study Permit');
    await expect(partner.getByText('Commission paid').locator('..')).toContainText('₹2,500');
    await expect(partner.getByText(/UTR998877/)).toBeVisible();
    // Progress only: no notes, documents or messages are exposed.
    await expect(partner.getByText(/Referred by sub-agent/)).toHaveCount(0);
  });

  test('deactivating a sub-agent ends their access', async () => {
    await staff.goto(agentUrl);
    await staff.getByRole('button', { name: 'Edit' }).click();
    await staff.getByRole('dialog').getByLabel('Active (can sign in and earn)').uncheck();
    await staff.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(staff.getByText('Inactive')).toBeVisible();
    await partner.goto(`/partner/${slug}`);
    await expect(partner).toHaveURL(new RegExp(`/partner/${slug}/login`));
  });

  test('no browser console errors', async () => {
    expect(consoleErrors).toEqual([]);
  });
});
