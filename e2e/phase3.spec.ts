import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Phase 3: client portal. Staff invites → client signs in with a one-time link →
// uploads, messages, books → staff sees it all; plus link reuse & isolation checks.

const run = Date.now().toString(36);
const slug = `p3-${run}`;
const pdf = { name: 'passport.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF passport') };

test.describe.serial('Phase 3 · client portal', () => {
  let staff: Page;
  let client: Page;
  let clientCtx: BrowserContext;
  let link = '';
  let clientUrl = '';

  test.beforeAll(async ({ browser }) => {
    staff = await browser.newPage();
    await staff.goto('/signup');
    await staff.getByLabel('Your name').fill('Divya Staff');
    await staff.getByLabel('Work email').fill(`p3-${run}@example.test`);
    await staff.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await staff.getByLabel('Confirm password').fill('kicko-pass-123');
    await staff.getByLabel('Agency name').fill(`Portal Agency ${run}`);
    await staff.getByLabel('Workspace address').fill(slug);
    await staff.getByRole('button', { name: 'Create account & workspace' }).click();
    await staff.waitForURL(`**/${slug}`);

    await staff.goto(`/${slug}/leads?new=1`);
    const d = staff.getByRole('dialog');
    await d.getByLabel('First name').fill('Priya');
    await d.getByLabel('Last name').fill('Raman');
    await d.getByLabel('Phone / WhatsApp').fill('9840011223');
    await d.getByLabel('Email').fill(`priya-${run}@example.test`);
    await d.getByLabel('Visa product').selectOption({ label: 'Canada · Study Permit' });
    await d.getByRole('button', { name: 'Create lead' }).click();
    await staff.waitForURL(/\/leads\//);
    await staff.getByRole('button', { name: 'Convert to client →' }).click();
    await staff.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
    await staff.waitForURL(/\/cases\//);
    await staff.getByRole('link', { name: 'Priya Raman' }).first().click();
    await staff.waitForURL(/\/clients\//);
    clientUrl = staff.url();

    clientCtx = await browser.newContext();
    client = await clientCtx.newPage();
  });

  test('staff creates a portal link (with WhatsApp share)', async () => {
    await staff.getByRole('button', { name: 'Create portal link' }).click();
    link = await staff.getByLabel('Portal link').inputValue();
    expect(link).toContain(`/portal/${slug}/auth?t=`);
    await expect(staff.getByRole('link', { name: 'WhatsApp', exact: true })).toHaveAttribute('href', /wa\.me\/919840011223/);
  });

  test('client signs in with one click and sees their journey', async () => {
    await client.goto(link);
    await client.getByRole('button', { name: 'Open my portal' }).click();
    await client.waitForURL(`**/portal/${slug}`);
    await expect(client.getByRole('heading', { level: 1 })).toContainText('Priya, you\'re 1 of 11 steps to Canada');
    await expect(client.getByText('13 things we need from you')).toBeVisible();
  });

  test('a login link works only once', async ({ browser }) => {
    const other = await browser.newContext();
    const p = await other.newPage();
    await p.goto(link);
    await p.getByRole('button', { name: 'Open my portal' }).click();
    await expect(p.getByText(/This link (has expired|was already used)/)).toBeVisible();
    await other.close();
  });

  test('client uploads a document; staff sees it to review and verifies', async () => {
    await client.getByLabel('Upload Passport (all pages)').setInputFiles(pdf);
    await expect(client.getByText('12 things we need from you')).toBeVisible();
    const checking = client.locator('div', { has: client.getByText('Being checked', { exact: true }) }).last();
    await expect(checking).toContainText('Passport (all pages)');

    await staff.goto(`/${slug}/documents`);
    await staff.getByRole('link', { name: /Passport \(all pages\)/ }).click();
    await staff.getByRole('button', { name: 'Review' }).click();
    await staff.getByRole('dialog').getByRole('button', { name: 'Verify' }).click();
    await expect(staff.getByText('1/13 required verified')).toBeVisible();

    await client.reload();
    await expect(client.getByText('Passport (all pages) verified')).toBeVisible(); // client-safe timeline
  });

  test('messages flow both ways and show in the staff inbox', async () => {
    await client.goto(`/portal/${slug}/messages`);
    await client.getByLabel('Message').fill('Hi, I paid the tuition deposit today.');
    await client.getByRole('button', { name: 'Send' }).click();
    await expect(client.getByText('Hi, I paid the tuition deposit today.')).toBeVisible();

    await staff.goto(`/${slug}`);
    const inbox = staff.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Inbox/ });
    await expect(inbox).toContainText('1');
    await inbox.click();
    await expect(staff.getByText('Hi, I paid the tuition deposit today.').first()).toBeVisible();
    await staff.getByPlaceholder(/Message Priya/).fill('Great, thanks Priya. Please upload the receipt.');
    await staff.getByRole('button', { name: 'Send' }).click();
    await expect(staff.getByText('Great, thanks Priya.', { exact: false }).last()).toBeVisible();

    await client.reload();
    await expect(client.getByText('Great, thanks Priya. Please upload the receipt.')).toBeVisible();
  });

  test('client books a meeting; it lands in the staff calendar', async () => {
    await client.goto(`/portal/${slug}/book`);
    await client.locator('fieldset').nth(1).getByRole('button').first().click();
    await client.getByRole('button', { name: 'Phone call' }).click();
    await client.getByLabel(/What would you like to discuss/).fill('GIC and biometrics');
    await client.getByRole('button', { name: /^Book / }).click();
    await client.waitForURL(/booked=1/);
    await expect(client.getByText('Booked. Your consultant has it in their calendar.')).toBeVisible();
    await expect(client.getByText('phone call')).toBeVisible();

    await staff.goto(clientUrl);
    await expect(staff.getByText('Consultation (booked online)')).toBeVisible();
  });

  test('portal session is scoped: no staff access, no other workspace, no other files', async ({ request }) => {
    await client.goto(`/${slug}`);
    await expect(client).toHaveURL(/\/login/); // staff area needs a staff login
    await client.goto(`/portal/demo`);
    await expect(client).toHaveURL(/\/portal\/demo\/login/); // cookie only valid for this agency's path
    const res = await client.request.get(`/portal/${slug}/files/invoice/not-mine`);
    expect(res.status()).toBe(404);
    const anon = await request.get(`/portal/${slug}/files/invoice/x`, { maxRedirects: 0 });
    expect([302, 307]).toContain(anon.status());
  });

  test('self-service sign-in link (email not configured → dev link)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`/portal/${slug}/login`);
    await p.getByLabel('Email').fill(`priya-${run}@example.test`);
    await p.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(p.getByText('Check your inbox.')).toBeVisible();
    await p.getByRole('link', { name: /Development only/ }).click();
    await p.getByRole('button', { name: 'Open my portal' }).click();
    await expect(p.getByRole('heading', { level: 1 })).toContainText('Priya');

    // Unknown emails get the same answer (no account probing). Fresh, signed-out context.
    const anon = await browser.newContext();
    const q = await anon.newPage();
    await q.goto(`/portal/${slug}/login`);
    await q.getByLabel('Email').fill('nobody@example.test');
    await q.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(q.getByText('Check your inbox.')).toBeVisible();
    await expect(q.getByRole('link', { name: /Development only/ })).toHaveCount(0);
    await anon.close();
    await ctx.close();
  });

  test('staff can revoke access', async () => {
    await staff.goto(clientUrl);
    staff.once('dialog', (d) => d.accept());
    await staff.getByRole('button', { name: 'Revoke access' }).click();
    await expect(staff.getByText('Portal access revoked')).toBeVisible();
    await client.goto(`/portal/${slug}`);
    await expect(client).toHaveURL(/\/login/);
  });
});
