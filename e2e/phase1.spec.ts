import { expect, test, type Page } from '@playwright/test';

// Full Phase 1 journey: agency signup → lead → duplicate guard → convert → case
// stages → tasks → public web form → walk-in kiosk → team invite → tenant isolation.

const run = Date.now().toString(36);
const owner = { name: 'Asha Owner', email: `owner-${run}@example.test`, password: 'kicko-pass-123' };
const agency = { name: `Horizon ${run}`, slug: `horizon-${run}` };

async function signUp(page: Page, who: typeof owner, ag: typeof agency) {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill(who.name);
  await page.getByLabel('Work email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByLabel('Agency name').fill(ag.name);
  await page.getByLabel('Workspace address').fill(ag.slug);
  await page.getByRole('button', { name: 'Create account & workspace' }).click();
  await page.waitForURL(`**/${ag.slug}`);
}

test.describe.serial('Phase 1', () => {
  let page: Page;
  let formLink = '';
  let kioskLink = '';
  let inviteLink = '';

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test('agency signs up and lands on the command dashboard', async () => {
    await signUp(page, owner, agency);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/All clear|need/);
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^Leads/ })).toBeVisible();
  });

  test('command bar opens with Ctrl+K (⌘K on Mac) and shows the right hint', async () => {
    const isMac = process.platform === 'darwin';
    await expect(page.locator('kbd', { hasText: isMac ? '⌘ K' : 'Ctrl K' })).toBeVisible();
    await page.locator('body').click();
    await page.keyboard.press(isMac ? 'Meta+k' : 'Control+k');
    await expect(page.getByRole('combobox', { name: 'Search or jump to' })).toBeFocused();
    await expect(page.getByRole('listbox')).toContainText('Walk-in queue');
    await page.keyboard.press('Escape');
  });

  test('creates a lead (auto-assigned) and opens its page', async () => {
    await page.goto(`/${agency.slug}/leads`);
    await page.getByRole('button', { name: 'New lead' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('First name').fill('Priya');
    await dialog.getByLabel('Last name').fill('Raman');
    await dialog.getByLabel('Phone / WhatsApp').fill('98765 43210');
    await dialog.getByLabel('Interested in').selectOption('STUDY');
    await dialog.getByLabel('Country').selectOption('CA');
    await dialog.getByLabel('Visa product').selectOption({ label: 'Canada · Study Permit' });
    await dialog.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/leads\/[a-z0-9]+$/);
    await expect(page.getByRole('heading', { name: 'Priya Raman' })).toBeVisible();
    await expect(page.getByText('Asha Owner', { exact: true })).toBeVisible(); // round-robin owner
  });

  test('warns about a duplicate phone number', async () => {
    await page.goto(`/${agency.slug}/leads`);
    await page.getByRole('button', { name: 'New lead' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('First name').fill('Priya');
    await dialog.getByLabel('Phone / WhatsApp').fill('+91 9876543210');
    await dialog.getByRole('button', { name: 'Create lead' }).click();
    await expect(dialog.getByText(/Possible duplicate/)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('converts the lead into a client with a case, and moves stages', async () => {
    await page.goto(`/${agency.slug}/leads?view=table`);
    await page.getByRole('link', { name: 'Priya Raman' }).click();
    await page.getByRole('button', { name: 'Contacted' }).click();
    await expect(page.locator('[aria-current="step"]')).toHaveText('Contacted');
    await page.getByRole('button', { name: 'Convert to client →' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
    await page.waitForURL(/\/cases\/[a-z0-9]+$/);
    await expect(page.getByText('Stage 1 of 11')).toBeVisible();
    await page.getByRole('button', { name: /Advance to Applications/ }).click();
    await expect(page.getByText('Stage 2 of 11')).toBeVisible();
    await expect(page.getByText('Counselling → Applications')).toBeVisible();
    await expect(page.getByText('Letter of acceptance (LOA)')).toBeVisible(); // checklist template
  });

  test('adds a task on the case and completes it from My tasks', async () => {
    await page.getByRole('button', { name: 'Task', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Task').fill('Collect GIC certificate');
    await page.getByRole('dialog').getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByText('Collect GIC certificate')).toBeVisible();
    await page.goto(`/${agency.slug}/tasks`);
    await expect(page.getByText('Collect GIC certificate')).toBeVisible();
    await page.getByRole('button', { name: 'Mark as done' }).first().click();
    await expect(page.getByText('Inbox zero')).toBeVisible();
  });

  test('captures a lead from the public website form', async ({ browser }) => {
    await page.goto(`/${agency.slug}/settings?tab=capture`);
    formLink = await page.getByLabel('Form link').inputValue();
    kioskLink = await page.getByLabel('Kiosk link').inputValue();

    const visitor = await browser.newPage(); // not signed in
    await visitor.goto(formLink);
    await visitor.getByLabel('First name').fill('Karthik');
    await visitor.getByLabel('Phone / WhatsApp').fill('9123456780');
    await visitor.getByLabel("I'm interested in").selectOption('PR');
    await visitor.getByRole('button', { name: 'Send enquiry' }).click();
    await expect(visitor.getByText("Thanks, we've got it.")).toBeVisible();

    await visitor.goto(formLink.replace(/k=[^&]+/, 'k=wrong-key'));
    await expect(visitor.getByText('404')).toBeVisible();
    await visitor.close();

    await page.goto(`/${agency.slug}/leads?view=table&source=WEB_FORM`);
    await expect(page.getByRole('link', { name: 'Karthik' })).toBeVisible();
  });

  test('walk-in kiosk check-in joins the reception queue', async ({ browser }) => {
    const kiosk = await browser.newPage();
    await kiosk.goto(kioskLink);
    await kiosk.getByLabel('Your name').fill('Fatima Sheikh');
    await kiosk.getByLabel('Mobile number').fill('9988776655');
    await kiosk.getByRole('button', { name: 'Spouse / family' }).click();
    await kiosk.getByRole('button', { name: 'Check in' }).click();
    await expect(kiosk.getByText(/checked in|Welcome back/)).toBeVisible();
    await kiosk.close();

    await page.goto(`/${agency.slug}/walk-ins`);
    await expect(page.getByText('Fatima Sheikh')).toBeVisible();
    await page.getByRole('button', { name: "I'll take them" }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  });

  test('public lead API accepts JSON with the form key', async ({ request }) => {
    const key = new URL(formLink).searchParams.get('k')!;
    const ok = await request.post(`/api/public/${agency.slug}/leads`, {
      headers: { 'X-Form-Key': key },
      data: { firstName: 'Api', lastName: 'Lead', email: `api-${run}@example.test`, interestCountry: 'AU' },
    });
    expect(ok.status()).toBe(201);
    const bad = await request.post(`/api/public/${agency.slug}/leads`, {
      headers: { 'X-Form-Key': 'nope' },
      data: { firstName: 'X', email: 'x@example.test' },
    });
    expect(bad.status()).toBe(401);
  });

  test('owner invites a counsellor who joins via the link', async ({ browser }) => {
    await page.goto(`/${agency.slug}/settings?tab=team`);
    await page.getByLabel('Email').fill(`counsellor-${run}@example.test`);
    await page.getByRole('button', { name: 'Create invite' }).click();
    inviteLink = await page.getByLabel('Invite link').inputValue();
    expect(inviteLink).toContain(`/invite/${agency.slug}/`);

    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto(inviteLink);
    await expect(p2.getByRole('heading', { name: `Join ${agency.name} on Kicko` })).toBeVisible();
    await p2.getByLabel('Your name').fill('Divya Counsellor');
    await p2.getByLabel('Choose a password').fill('kicko-pass-456');
    await p2.getByRole('button', { name: 'Join the team' }).click();
    await p2.waitForURL(`**/${agency.slug}`);
    // Counsellors don't get settings.
    await expect(p2.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await ctx.close();
  });

  test("another agency can't see this agency's workspace", async ({ browser }) => {
    const ctx = await browser.newContext();
    const p3 = await ctx.newPage();
    const other = { name: 'Other Owner', email: `other-${run}@example.test`, password: 'kicko-pass-789' };
    await signUp(p3, other, { name: `Rival ${run}`, slug: `rival-${run}` });
    await p3.goto(`/${agency.slug}/leads`);
    await expect(p3.getByText('404')).toBeVisible();
    const res = await p3.request.get(`/api/t/${agency.slug}/search?q=Priya`);
    expect(res.status()).toBe(404);
    await ctx.close();
  });
});
