import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';
import { xlsx } from './xlsx';
import { testMobile, verifyMobile } from './helpers';

// Phase 7c: import leads from a messy CSV and clients from Excel, with column
// guessing, a preview (new / duplicates / errors), owner matching, original dates,
// converting matching leads, and undo.

const run = Date.now().toString(36);
const slug = `p7c-${run}`;
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
const T = `(SELECT id FROM "Tenant" WHERE slug = $1)`;

const CSV = [
  'Sl No,Student Name,Mobile No.,Email ID,Lead Status,Service,Preferred Country,Counsellor,Remarks,Enquiry Date',
  '1,Priya Sharma,98400 11111,PRIYA@x.test,Follow up,Student visa,Canada,Owner Import,"Sept intake, IELTS 7",12/03/2026',
  '2,Arun Kumar,98400 22222,,Not interested,PR,Australia,,,01/02/2026',
  '3,Existing Person,9840099001,,,,,,,',
  '4,Priya again,98400-11111,,,,,,,',
  '5,No Contact,,,,,,,,',
  '6,Bad Email,98400 33333,not-an-email,Maybe,,UK,,,someday',
].join('\n');

test.describe.serial('Phase 7c · import', () => {
  let page: Page;
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
    });
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Owner Import');
    await page.getByLabel('Work email').fill(`p7c-${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await page.getByLabel('Confirm password').fill('kicko-pass-123');
    await page.getByLabel('Mobile number').fill(testMobile());
    await page.getByLabel('Agency name').fill(`Import Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await verifyMobile(page);
    await page.waitForURL(`**/${slug}`);
    // An existing lead the file will collide with.
    await page.goto(`/${slug}/leads?new=1`);
    const d = page.getByRole('dialog');
    await d.getByLabel('First name').fill('Existing');
    await d.getByLabel('Phone / WhatsApp').fill('9840099001');
    await d.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/leads\/[^?]+$/);
  });

  test('a CSV of leads: columns are guessed, problems shown before anything is saved', async () => {
    await page.goto(`/${slug}/leads`);
    await page.getByRole('link', { name: 'Import', exact: true }).click();
    await page.waitForURL(`**/${slug}/import`);
    await page.getByLabel('Spreadsheet file').setInputFiles({ name: 'zoho-leads.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
    await expect(page.getByText('6 rows · 10 columns')).toBeVisible();
    await expect(page.getByLabel('Column for Full name')).toHaveValue('1');
    await expect(page.getByLabel('Column for Phone / WhatsApp')).toHaveValue('2');
    await expect(page.getByLabel('Column for Enquiry date')).toHaveValue('9');
    await expect(page.getByLabel('Column for Owner')).toHaveValue('7');
    await page.getByRole('button', { name: 'Check the file' }).click();

    const summary = page.getByLabel('Summary');
    await expect(summary).toContainText('3new leads');
    await expect(summary).toContainText('2skipped (duplicates)');
    await expect(summary).toContainText('1can’t be imported');
    await expect(page.getByRole('row', { name: /No Contact|^5/ }).first()).toBeVisible();
    await expect(page.getByText('No phone or email')).toBeVisible();
    await expect(page.getByText('Same person as row 2')).toBeVisible();
    await expect(page.getByText(/Already exists \(L-\d+ Existing\)/)).toBeVisible();
    await expect(page.getByText(/Email “not-an-email” isn't valid/)).toBeVisible();
    expect(await q(`SELECT 1 FROM "Lead" WHERE "tenantId" = ${T}`, [slug])).toHaveLength(1); // nothing saved yet
  });

  test('import saves leads with their original dates, status, visa type and owner', async () => {
    await page.getByRole('button', { name: 'Import 3 leads' }).click();
    await expect(page.getByText('Import finished')).toBeVisible();
    await expect(page.getByText('3 created · 0 updated · 2 skipped · 1 couldn’t be imported')).toBeVisible();
    const rows = await q<{ firstName: string; status: string; interestCategory: string | null; interestCountry: string | null; created: string; owned: boolean; message: string | null; email: string | null }>(
      `SELECT l."firstName", l.status, l."interestCategory", l."interestCountry", to_char(l."createdAt", 'YYYY-MM-DD') AS created, l."ownerId" IS NOT NULL AS owned, l.message, l.email
       FROM "Lead" l WHERE l."tenantId" = ${T} AND l."firstName" <> 'Existing' ORDER BY l.ref`,
      [slug],
    );
    expect(rows).toEqual([
      { firstName: 'Priya', status: 'CONTACTED', interestCategory: 'STUDY', interestCountry: 'CA', created: '2026-03-12', owned: true, message: 'Sept intake, IELTS 7', email: 'priya@x.test' },
      { firstName: 'Arun', status: 'LOST', interestCategory: 'PR', interestCountry: 'AU', created: '2026-02-01', owned: false, message: null, email: null },
      { firstName: 'Bad', status: 'NEW', interestCategory: null, interestCountry: 'GB', created: expect.any(String), owned: false, message: null, email: null },
    ]);
    await page.getByRole('link', { name: 'View leads' }).click();
    await expect(page.getByRole('link', { name: /Priya Sharma/ }).first()).toBeVisible();
  });

  test('an Excel file of clients: real date cells, numeric phones, and a matching lead is converted', async () => {
    await page.goto(`/${slug}/clients`);
    await page.getByRole('link', { name: 'Import', exact: true }).click();
    await page.waitForURL(/import\?type=clients/);
    const file = xlsx([
      ['Name', 'Phone', 'DOB', 'Passport No', 'Passport Expiry', 'Nationality', 'Remarks'],
      ['Arun Kumar', 9840022222, new Date(Date.UTC(1996, 7, 14)), 'n 1234567', '30/06/2031', 'India', 'Paid in full'],
      ['Meena Raj', 9840044444, new Date(Date.UTC(1999, 0, 2)), 'P7654321', null, 'India', null],
    ]);
    await page.getByLabel('Spreadsheet file').setInputFiles({ name: 'clients.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: file });
    await expect(page.getByText('2 rows · 7 columns')).toBeVisible();
    await page.getByRole('button', { name: 'Check the file' }).click();
    await expect(page.getByLabel('Summary')).toContainText('1new clients');
    await expect(page.getByLabel('Summary')).toContainText('1from existing leads');
    await expect(page.getByText(/Converts lead L-\d+/)).toBeVisible();
    await page.getByRole('button', { name: 'Import 2 clients' }).click();
    await expect(page.getByText('2 created · 0 updated · 0 skipped · 0 couldn’t be imported')).toBeVisible();

    const clients = await q<{ firstName: string; dob: string; passportNumber: string; expiry: string | null; nationality: string; phoneNormalized: string; notes: number }>(
      `SELECT c."firstName", to_char(c.dob, 'YYYY-MM-DD') AS dob, c."passportNumber", to_char(c."passportExpiry", 'YYYY-MM-DD') AS expiry, c.nationality, c."phoneNormalized",
              (SELECT count(*)::int FROM "Note" n WHERE n."clientId" = c.id) AS notes
       FROM "Client" c WHERE c."tenantId" = ${T} ORDER BY c.ref`,
      [slug],
    );
    expect(clients).toEqual([
      { firstName: 'Arun', dob: '1996-08-14', passportNumber: 'N1234567', expiry: '2031-06-30', nationality: 'India', phoneNormalized: '+919840022222', notes: 1 },
      { firstName: 'Meena', dob: '1999-01-02', passportNumber: 'P7654321', expiry: null, nationality: 'India', phoneNormalized: '+919840044444', notes: 0 },
    ]);
    const [arun] = await q<{ status: string; converted: boolean }>(`SELECT status, "clientId" IS NOT NULL AS converted FROM "Lead" WHERE "tenantId" = ${T} AND "firstName" = 'Arun'`, [slug]);
    expect(arun).toEqual({ status: 'WON', converted: true });
  });

  test('undo removes what each import created and reopens converted leads', async () => {
    page.on('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Undo this import' }).click();
    await expect(page.getByText('Drop a CSV or Excel file', { exact: false })).toBeVisible();
    expect(await q(`SELECT 1 FROM "Client" WHERE "tenantId" = ${T}`, [slug])).toHaveLength(0);
    const [arun] = await q<{ status: string; converted: boolean }>(`SELECT status, "clientId" IS NOT NULL AS converted FROM "Lead" WHERE "tenantId" = ${T} AND "firstName" = 'Arun'`, [slug]);
    expect(arun).toEqual({ status: 'QUALIFIED', converted: false });

    const past = page.getByRole('listitem').filter({ hasText: 'zoho-leads.csv' });
    await expect(past).toContainText('6 rows: 3 created, 0 updated, 2 skipped, 1 failed');
    await past.getByText(/rows? not imported/).click();
    await expect(past.getByText('Row 6: No phone or email')).toBeVisible();
    await past.getByRole('button', { name: 'Undo' }).click();
    await expect(past.getByText('Undone')).toBeVisible();
    const left = await q<{ firstName: string }>(`SELECT "firstName" FROM "Lead" WHERE "tenantId" = ${T}`, [slug]);
    expect(left.map((l) => l.firstName)).toEqual(['Existing']);
  });

  test('no browser console errors', async () => {
    expect(consoleErrors).toEqual([]);
  });
});
