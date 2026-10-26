import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { testMobile, verifyMobile } from './helpers';

// Phase 4.5: integration foundation. Integrations overview, generic connection
// cards, sandbox payment gateway end to end (staff link + client portal), usage metering.

const run = Date.now().toString(36);
const slug = `p45-${run}`;

test.describe.serial('Phase 4.5 · integrations', () => {
  let staff: Page;
  let client: Page;
  let clientCtx: BrowserContext;
  let invoiceUrl = '';

  test.beforeAll(async ({ browser }) => {
    staff = await browser.newPage();
    await staff.goto('/signup');
    await staff.getByLabel('Your name').fill('Owner Fourfive');
    await staff.getByLabel('Work email').fill(`p45-${run}@example.test`);
    await staff.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await staff.getByLabel('Confirm password').fill('kicko-pass-123');
    await staff.getByLabel('Mobile number').fill(testMobile());
    await staff.getByLabel('Agency name').fill(`Integrations Agency ${run}`);
    await staff.getByLabel('Workspace address').fill(slug);
    await staff.getByRole('button', { name: 'Create account & workspace' }).click();
    await verifyMobile(staff);
    await staff.waitForURL(`**/${slug}`);
    clientCtx = await browser.newContext();
    client = await clientCtx.newPage();
  });

  test('integrations overview lists every capability', async () => {
    await staff.goto(`/${slug}/settings?tab=integrations`);
    const row = (name: string) => staff.locator('li', { hasText: name });
    await expect(row('WhatsApp & messaging').getByText('Not connected')).toBeVisible();
    await expect(row('Payment links').getByText('Not connected')).toBeVisible();
    await expect(row('Phone calls').getByText('Not connected')).toBeVisible();
    await expect(row('AI voice agent').getByText('Not connected')).toBeVisible();
    await expect(staff.getByText('Nothing used yet.')).toBeVisible();
  });

  test('connect sandbox payments from the billing tab', async () => {
    await staff.goto(`/${slug}/settings?tab=billing`);
    await staff.getByRole('button', { name: 'Use sandbox payments' }).click();
    await expect(staff.getByText('Sandbox', { exact: true })).toBeVisible();
    await expect(staff.getByLabel('Webhook URL')).toHaveValue(new RegExp(`/api/webhooks/payments/payments-sandbox/${slug}$`));
    await staff.getByRole('button', { name: 'Test connection' }).click();
    await expect(staff.getByText('Connection works')).toBeVisible();

    // The real gateway can still be set up next to it; the form is generated from its descriptor.
    await staff.getByRole('button', { name: 'Set up' }).click();
    await expect(staff.getByLabel('Key ID')).toBeVisible();
    await expect(staff.getByLabel('Razorpay webhook URL')).toHaveValue(new RegExp(`/api/webhooks/payments/razorpay/${slug}$`));
  });

  test('staff payment link → sandbox checkout → invoice part paid', async () => {
    await staff.getByRole('button', { name: '+ Package' }).click();
    const d = staff.getByRole('dialog');
    await d.getByLabel('Name').fill('Visit visa: full service');
    await d.getByLabel('Price before tax (₹)').fill('10000');
    await d.getByRole('button', { name: 'Save package' }).click();
    await expect(staff.getByText('₹10,000')).toBeVisible();

    await staff.goto(`/${slug}/leads?new=1`);
    const l = staff.getByRole('dialog');
    await l.getByLabel('First name').fill('Arjun');
    await l.getByLabel('Last name').fill('Mehta');
    await l.getByLabel('Phone / WhatsApp').fill('9840099887');
    await l.getByLabel('Country', { exact: true }).selectOption('CA');
    await l.getByLabel('Visa product').selectOption({ label: 'Canada · Study Permit' });
    await l.getByRole('button', { name: 'Create lead' }).click();
    await staff.waitForURL(/\/leads\//);
    await staff.getByRole('button', { name: 'Convert to client →' }).click();
    await staff.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
    await staff.waitForURL(/\/cases\//);

    await staff.getByRole('link', { name: '+ Invoice' }).click();
    await staff.waitForURL(/billing\/new/);
    await staff.getByRole('button', { name: /Visit visa: full service/ }).click();
    await staff.getByRole('button', { name: 'Create & issue invoice' }).click();
    await staff.waitForURL(/\/billing\/[a-z0-9]+$/);
    invoiceUrl = staff.url();

    await staff.getByRole('button', { name: 'Payment link' }).click();
    const link = await staff.getByLabel('Payment link').inputValue();
    expect(link).toContain(`/pay/sandbox/${slug}/plink_sbx_`);

    // The client opens the link (no login): sandbox checkout acts like a hosted gateway page.
    await client.goto(link);
    await expect(client.getByText('Test checkout')).toBeVisible();
    await expect(client.getByText('₹5,900')).toBeVisible(); // first installment: 50% of ₹11,800
    await client.getByRole('button', { name: 'Simulate successful payment' }).click();
    await client.waitForURL(/\/pay\/thanks/);
    await expect(client.getByRole('heading', { name: 'Payment received. Thank you.' })).toBeVisible();

    await staff.goto(invoiceUrl);
    await expect(staff.getByText('Part paid')).toBeVisible();
    await expect(staff.getByText(/RCPT\/\d{2}-\d{2}\/0001/)).toBeVisible();

    // A paid link can't be paid twice.
    await client.goto(link);
    await expect(client.getByText('This link has already been paid.')).toBeVisible();
  });

  test('client pays the next installment from the portal', async () => {
    await staff.getByRole('link', { name: 'Arjun Mehta' }).first().click();
    await staff.waitForURL(/\/clients\//);
    await staff.getByRole('button', { name: 'Create portal link' }).click();
    const portal = await staff.getByLabel('Portal link').inputValue();

    await client.goto(portal);
    await client.getByRole('button', { name: 'Open my portal' }).click();
    await client.waitForURL(`**/portal/${slug}`);
    await client.getByRole('button', { name: 'Pay with UPI / card' }).click();
    await client.waitForURL(/\/pay\/sandbox\//);
    await expect(client.getByText('₹3,540')).toBeVisible(); // second installment: 30%
    await client.getByRole('button', { name: 'Simulate successful payment' }).click();
    await client.waitForURL(/\/pay\/thanks/);

    await staff.goto(invoiceUrl);
    await expect(staff.getByText(/RCPT\/\d{2}-\d{2}\/0002/)).toBeVisible();
  });

  test('forged gateway webhooks are refused; stale provider URLs 404', async ({ request }) => {
    const body = JSON.stringify({ linkId: 'plink_sbx_x', paymentId: 'pay_x', amount: 1, method: 'upi', paidAt: new Date().toISOString() });
    const forged = await request.post(`/api/webhooks/payments/payments-sandbox/${slug}`, { data: body, headers: { 'content-type': 'application/json', 'x-sandbox-signature': 'forged' } });
    expect(forged.status()).toBe(401);
    // Not the connected provider for this workspace.
    expect((await request.post(`/api/webhooks/payments/razorpay/${slug}`, { data: body })).status()).toBe(404);
    expect((await request.post(`/api/webhooks/telephony/x/${slug}`, { data: body })).status()).toBe(404);
  });

  test('usage is metered per workspace', async () => {
    await staff.goto(`/${slug}/settings?tab=integrations`);
    await expect(staff.locator('li', { hasText: 'Payment links' }).getByText('Sandbox · Sandbox payments')).toBeVisible();
    await expect(staff.getByRole('row', { name: 'Payment links payments-sandbox 2 payment links' })).toBeVisible();
    await expect(staff.getByRole('row', { name: 'Payment links payments-sandbox 2 payments received' })).toBeVisible();
  });

  test('disconnect returns the workspace to "not connected"', async () => {
    await staff.goto(`/${slug}/settings?tab=billing`);
    staff.once('dialog', (d) => d.accept());
    await staff.getByRole('button', { name: 'Disconnect' }).click();
    await expect(staff.getByText('Not connected', { exact: true })).toBeVisible();
    await staff.goto(invoiceUrl);
    await expect(staff.getByText('Connect a payment gateway in Settings → Billing')).toBeVisible();
  });
});
