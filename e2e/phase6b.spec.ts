import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Phase 6b: government form answer sheets. Profile → DS-160 sheet in its own date
// format → staff answers → ask the client → client answers in the portal (a "Yes"
// needs details) → shared across forms → PDF export.

const run = Date.now().toString(36);
const slug = `p6b-${run}`;

test.describe.serial('Phase 6b · government form auto-fill', () => {
  let staff: Page;
  let client: Page;
  let clientCtx: BrowserContext;
  let clientUrl = '';
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    staff = await browser.newPage();
    clientCtx = await browser.newContext();
    client = await clientCtx.newPage();
    for (const pg of [staff, client]) {
      pg.on('console', (m) => {
        if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
      });
    }
    await staff.goto('/signup');
    await staff.getByLabel('Your name').fill('Owner Forms');
    await staff.getByLabel('Work email').fill(`p6b-${run}@example.test`);
    await staff.getByLabel('Password').fill('kicko-pass-123');
    await staff.getByLabel('Agency name').fill(`Forms Agency ${run}`);
    await staff.getByLabel('Workspace address').fill(slug);
    await staff.getByRole('button', { name: 'Create account & workspace' }).click();
    await staff.waitForURL(`**/${slug}`);

    await staff.goto(`/${slug}/leads?new=1`);
    const d = staff.getByRole('dialog');
    await d.getByLabel('First name').fill('Priya');
    await d.getByLabel('Last name').fill('Raman');
    await d.getByLabel('Phone / WhatsApp').fill('9840011223');
    await d.getByLabel('Visa product').selectOption({ label: 'Canada · Study Permit' });
    await d.getByRole('button', { name: 'Create lead' }).click();
    await staff.waitForURL(/\/leads\//);
    await staff.getByRole('button', { name: 'Convert to client →' }).click();
    await staff.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
    await staff.waitForURL(/\/cases\//);
    await staff.getByRole('link', { name: 'Priya Raman' }).first().click();
    await staff.waitForURL(/\/clients\//);
    clientUrl = staff.url().split('?')[0]!;

    await staff.goto(`${clientUrl}?tab=profile`);
    await staff.getByLabel('Date of birth').first().fill('1999-04-12');
    await staff.getByLabel('Gender').selectOption('Female');
    await staff.getByLabel('Passport number').first().fill('Z1234567');
    await staff.getByLabel('Passport expiry').fill('2032-01-09');
    await staff.getByLabel('Marital status').selectOption('Single');
    await staff.getByRole('button', { name: 'Save profile' }).click();
    await expect(staff.getByRole('button', { name: 'Save profile' })).toBeEnabled();
  });

  test('the DS-160 sheet fills from the profile in its own format', async () => {
    await staff.goto(`${clientUrl}?tab=forms`);
    await expect(staff.getByRole('link', { name: /USA · DS-160/ })).toBeVisible();
    await staff.getByRole('link', { name: /USA · DS-160/ }).click();
    await expect(staff.getByRole('heading', { name: 'USA · DS-160 nonimmigrant visa' })).toBeVisible();
    const row = (label: string) => staff.getByRole('listitem').filter({ has: staff.getByText(label, { exact: true }) });
    await expect(row('Surnames')).toContainText('RAMAN');
    await expect(row('Date of birth')).toContainText('12-APR-1999');
    await expect(row('Passport number')).toContainText('Z1234567');
    await expect(row('City of birth')).toContainText('Missing');
  });

  test('staff fills an answer; it shows as a staff answer on the sheet', async () => {
    await staff.getByLabel('City or town of birth').fill('Madurai');
    await staff.getByRole('button', { name: 'Save answers' }).click();
    const row = staff.getByRole('listitem').filter({ has: staff.getByText('City of birth', { exact: true }) });
    await expect(row).toContainText('Madurai');
    await expect(row).toContainText('Staff');
  });

  test('ask the client; they answer in the portal, and a "Yes" needs details', async () => {
    await staff.getByRole('button', { name: /Ask client for \d+ answers/ }).click();
    await expect(staff.getByText(/Asked the client for \d+ answers in their portal/)).toBeVisible();

    await staff.goto(clientUrl);
    await staff.getByRole('button', { name: 'Create portal link' }).click();
    const link = await staff.getByLabel('Portal link').inputValue();
    await client.goto(link);
    await client.getByRole('button', { name: 'Open my portal' }).click();
    await client.waitForURL(`**/portal/${slug}`);
    await client.getByRole('link', { name: /Your consultant needs \d+ details/ }).click();
    await expect(client.getByRole('heading', { name: 'A few questions for your application' })).toBeVisible();

    await client.getByLabel('Country of birth').fill('India');
    await client.getByLabel('Purpose of the trip').fill('Tourism and visiting family');
    await client.locator('fieldset', { hasText: 'refused a visa' }).getByText('Yes', { exact: true }).click();
    await client.getByRole('button', { name: 'Save answers' }).click();
    await expect(client.getByText(/please add the details/)).toBeVisible();
    // The form keeps what was typed after an error.
    await expect(client.getByLabel('Country of birth')).toHaveValue('India');
    await client.getByLabel(/refused a visa .*: details/).fill('UK visitor visa, 2019, insufficient funds');
    await client.getByRole('button', { name: 'Save answers' }).click();
    await expect(client.getByText('Saved. Thank you!')).toBeVisible();
  });

  test('client answers appear on every form, marked as the client\'s', async () => {
    await staff.goto(`${clientUrl}?tab=forms&form=us-ds160`);
    const ds = (label: string) => staff.getByRole('listitem').filter({ has: staff.getByText(label, { exact: true }) });
    await expect(ds('Country/region of birth')).toContainText('India');
    await expect(ds('Country/region of birth')).toContainText('Client answered');
    await expect(ds('Refused a visa or entry, or removed, from any country?')).toContainText('Yes: UK visitor visa, 2019, insufficient funds');

    await staff.goto(`${clientUrl}?tab=forms&form=ca-personal`);
    const ca = (label: string) => staff.getByRole('listitem').filter({ has: staff.getByText(label, { exact: true }) });
    await expect(ca('City/town of birth')).toContainText('Madurai');
    await expect(ca('Country of birth')).toContainText('India');
    await expect(ca('Date of birth')).toContainText('1999-04-12');
  });

  test('download the sheet as PDF', async () => {
    const res = await staff.request.get(`/api/t/${slug}/clients/${clientUrl.split('/').pop()}/forms/us-ds160`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    expect((await res.body()).subarray(0, 4).toString()).toBe('%PDF');
    // Signed-out requests can't get it.
    const anon = await client.request.get(`/api/t/${slug}/clients/${clientUrl.split('/').pop()}/forms/us-ds160`, { maxRedirects: 0 });
    expect(anon.status()).not.toBe(200);
  });

  test('no browser console errors', async () => {
    expect(consoleErrors).toEqual([]);
  });
});
