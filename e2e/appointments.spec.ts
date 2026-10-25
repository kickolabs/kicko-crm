import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';
import { testMobile, verifyMobile } from './helpers';

// Staff booking can't land in the past (the picker's min, and the server for crafted
// requests), must fit office hours unless an owner/admin overrides, and can be rescheduled.
// A new workspace's office hours are Mon–Sat 10:00–18:00, Asia/Kolkata.

const run = Date.now().toString(36);
const owner = { name: 'Bina Owner', email: `appt-${run}@example.test`, password: 'kicko-pass-123' };
const agency = { name: `Slots ${run}`, slug: `slots-${run}` };
const TZ = 'Asia/Kolkata';
const DB = 'postgresql://postgres:postgres@localhost:5433/kicko';

async function q(sql: string, params: unknown[] = []) {
  const db = new Pg(DB);
  await db.connect();
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.end();
  }
}

/** A datetime-local value for `daysAhead` days from now at `hhmm`, in the agency timezone. */
function local(daysAhead: number, hhmm: string) {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return `${ymd}T${hhmm}`;
}
const weekday = (daysAhead: number) =>
  new Date(`${local(daysAhead, '12:00').slice(0, 10)}T12:00:00Z`).getUTCDay();
/** Days until the next weekday matching `test` (at least 1). */
const nextDay = (test: (wd: number) => boolean) => {
  for (let i = 1; i < 9; i++) if (test(weekday(i))) return i;
  throw new Error('no day');
};
const workday = nextDay((wd) => wd !== 0);
const laterWorkday = workday + nextDay((wd) => wd !== 0 && wd !== weekday(workday));
const sunday = nextDay((wd) => wd === 0);

test.describe.serial('Appointment booking rules', () => {
  let page: Page;

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

    await page.goto(`/${agency.slug}/leads`);
    await page.getByRole('button', { name: 'New lead' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('First name').fill('Ravi');
    await dialog.getByLabel('Phone / WhatsApp').fill('98111 22334');
    await dialog.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/leads\/[a-z0-9]+$/);
  });

  test.afterAll(() => page.close());

  const panel = () => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Appointments' }) });

  async function openBooking() {
    await page.getByRole('button', { name: 'Book', exact: true }).click();
    return page.getByRole('dialog');
  }

  test('the picker starts at now and flags a time that has passed', async () => {
    const dialog = await openBooking();
    const starts = dialog.getByLabel('Starts');
    const min = await starts.getAttribute('min');
    expect(min && min >= local(0, '00:00')).toBeTruthy();
    await starts.fill(local(-1, '11:00'));
    await expect(dialog.getByText('That time has already passed. Pick a later time.')).toBeVisible();
    // The browser refuses to submit a value below min: the dialog stays open.
    await dialog.getByRole('button', { name: 'Book appointment' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('None booked.')).toBeVisible();
  });

  test('the server refuses a past time even when the picker is bypassed', async () => {
    const dialog = await openBooking();
    const starts = dialog.getByLabel('Starts');
    await starts.evaluate((el) => el.removeAttribute('min'));
    await starts.fill(local(-1, '11:00'));
    await dialog.getByRole('button', { name: 'Book appointment' }).click();
    await expect(dialog.getByText('That date is in the past. Pick a future date.').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('None booked.')).toBeVisible();
  });

  test('books a future time inside office hours', async () => {
    const dialog = await openBooking();
    await dialog.getByLabel('Title').fill('Eligibility consultation');
    await dialog.getByLabel('Starts').fill(local(workday, '11:00'));
    await dialog.getByRole('button', { name: 'Book appointment' }).click();
    await expect(dialog).toBeHidden();
    await expect(panel().getByText('Eligibility consultation')).toBeVisible();
  });

  test('outside office hours needs the owner override', async () => {
    let dialog = await openBooking();
    await dialog.getByLabel('Title').fill('Sunday call');
    await dialog.getByLabel('Starts').fill(local(sunday, '11:00'));
    await dialog.getByRole('button', { name: 'Book appointment' }).click();
    await expect(dialog.getByText('The office is closed on Sundays').first()).toBeVisible();
    await page.keyboard.press('Escape');

    dialog = await openBooking();
    await dialog.getByLabel('Title').fill('Sunday call');
    await dialog.getByLabel('Starts').fill(local(sunday, '11:00'));
    await dialog.getByLabel('Book outside office hours').check();
    await dialog.getByRole('button', { name: 'Book appointment' }).click();
    await expect(dialog).toBeHidden();
    await expect(panel().getByText('Sunday call')).toBeVisible();
  });

  test('a clash with the same consultant is refused', async () => {
    const dialog = await openBooking();
    await dialog.getByLabel('Title').fill('Double booked');
    await dialog.getByLabel('Starts').fill(local(workday, '11:15'));
    await dialog.getByRole('button', { name: 'Book appointment' }).click();
    await expect(dialog.getByText('Clashes with "Eligibility consultation"').first()).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('reschedules to a new valid time, but not into the past', async () => {
    const row = panel().getByRole('listitem').filter({ hasText: 'Eligibility consultation' });
    await row.getByRole('button', { name: 'Reschedule' }).click();
    let dialog = page.getByRole('dialog');
    const when = dialog.getByLabel('New time');
    await when.evaluate((el) => el.removeAttribute('min'));
    await when.fill(local(-2, '12:00'));
    await dialog.getByRole('button', { name: 'Move appointment' }).click();
    await expect(dialog.getByText('That date is in the past. Pick a future date.').first()).toBeVisible();
    await page.keyboard.press('Escape');

    await row.getByRole('button', { name: 'Reschedule' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('New time').fill(local(laterWorkday, '15:00'));
    await dialog.getByRole('button', { name: 'Move appointment' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Appointment moved: Eligibility consultation').first()).toBeVisible();
  });

  test('a past appointment can still be marked done', async () => {
    // Status changes never re-check the time, so history stays editable.
    await q(
      `UPDATE "Appointment" SET "startsAt" = now() - interval '2 days', "endsAt" = now() - interval '2 days' + interval '30 minutes'
       WHERE title = 'Sunday call' AND "tenantId" = (SELECT id FROM "Tenant" WHERE slug = $1)`,
      [agency.slug],
    );
    await page.reload();
    const row = panel().getByRole('listitem').filter({ hasText: 'Sunday call' });
    await row.getByRole('button', { name: 'Done' }).click();
    await expect(row.getByText('Completed')).toBeVisible();
  });
});
