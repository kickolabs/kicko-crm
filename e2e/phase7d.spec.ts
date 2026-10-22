import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { Client as Pg } from 'pg';

// Phase 7d: custom fields (define, fill, import into, report on) and reports
// (ready-made, builder, save, CSV), plus what a lower plan can and can't do.

const run = Date.now().toString(36);
const slug = `p7d-${run}`;
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

test.describe.serial('Phase 7d · custom fields & reports', () => {
  let page: Page;
  let leadUrl = '';
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
    });
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Owner Reports');
    await page.getByLabel('Work email').fill(`p7d-${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await page.getByLabel('Confirm password').fill('kicko-pass-123');
    await page.getByLabel('Agency name').fill(`Reports Agency ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await page.waitForURL(`**/${slug}`);
  });

  const addField = async (one: string, label: string, type: string, options?: string) => {
    const form = page.locator('form', { has: page.getByLabel(`New ${one} field name`) });
    await form.getByLabel(`New ${one} field name`).fill(label);
    await form.getByLabel(`New ${one} field type`).selectOption({ label: type });
    if (options) await form.getByLabel(`New ${one} field options`).fill(options);
    await form.getByRole('button', { name: 'Add field' }).click();
    await expect(page.getByRole('list', { name: `${one[0]!.toUpperCase()}${one.slice(1)}s fields` }).getByText(label, { exact: true })).toBeVisible();
  };

  test('owners define custom fields per record type', async () => {
    await page.goto(`/${slug}/settings?tab=fields`);
    await addField('lead', 'Intake', 'Dropdown', 'Jan\nMay\nSept');
    await addField('lead', 'Budget', 'Number');
    await addField('client', 'Refusal history', 'Yes / No');
    await addField('case', 'Offer deadline', 'Date');
    const form = page.locator('form', { has: page.getByLabel('New lead field name') });
    await form.getByLabel('New lead field name').fill('intake');
    await form.getByRole('button', { name: 'Add field' }).click();
    await expect(form.getByText('There is already a field called “intake”')).toBeVisible();
  });

  test('values are filled and checked on the lead page', async () => {
    await page.goto(`/${slug}/leads?new=1`);
    const d = page.getByRole('dialog');
    await d.getByLabel('First name').fill('Kavya');
    await d.getByLabel('Phone / WhatsApp').fill('9840100009');
    await d.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/leads\/[^?]+$/);
    leadUrl = page.url();
    await expect(page.getByText('Nothing filled in yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByLabel('Intake').selectOption('May');
    await page.getByLabel('Budget').fill('lots');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Budget: “lots” isn\'t a number')).toBeVisible();
    await page.getByLabel('Budget').fill('12,50,000');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('12,50,000')).toBeVisible();
    const [lead] = await q<{ customFields: unknown }>(`SELECT "customFields" FROM "Lead" WHERE "firstName" = 'Kavya' AND "tenantId" = (SELECT id FROM "Tenant" WHERE slug = $1)`, [slug]);
    expect(lead!.customFields).toEqual({ intake: 'May', budget: 1250000 });
  });

  test('an import fills custom fields from matching columns', async () => {
    await page.goto(`/${slug}/import`);
    const csv = ['Name,Mobile,Source,Status,Intake,Budget', 'Arjun,9840100001,Facebook,Converted,Jan,1 00 000', 'Bala,9840100002,Facebook,New,may,', 'Chitra,9840100003,Referral,Converted,May,', 'Divya,9840100004,Walk in,Lost,Sept,'].join('\n');
    await page.getByLabel('Spreadsheet file').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByLabel('Column for Intake')).toHaveValue('4');
    await expect(page.getByLabel('Column for Budget')).toHaveValue('5');
    await page.getByRole('button', { name: 'Check the file' }).click();
    await page.getByRole('button', { name: 'Import 4 leads' }).click();
    await expect(page.getByText('Import finished')).toBeVisible();
    const rows = await q<{ firstName: string; customFields: unknown }>(`SELECT "firstName", "customFields" FROM "Lead" WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = $1) AND "firstName" IN ('Arjun', 'Bala') ORDER BY "firstName"`, [slug]);
    expect(rows.map((r) => r.customFields)).toEqual([{ intake: 'Jan', budget: 100000 }, { intake: 'May' }]);
  });

  test('ready-made report: conversion by source', async () => {
    await page.goto(`/${slug}/reports`);
    await expect(page.getByRole('heading', { name: 'Which sources bring clients' })).toBeVisible();
    const row = (name: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
    await expect(row('Ads')).toContainText('50%of 2');
    await expect(row('Referral')).toContainText('100%of 1');
    await expect(row('Walk-in')).toContainText('0%of 1');
    await expect(row('Total')).toContainText('40%of 5');
    await page.getByRole('link', { name: 'Counsellor performance' }).click();
    await expect(page.getByRole('heading', { name: 'Counsellor performance' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Won' })).toBeVisible();
  });

  test('build a report grouped by a custom field, save it and download CSV', async () => {
    await page.goto(`/${slug}/reports?r=lead-sources`);
    await page.getByLabel('Measure').selectOption({ label: 'Number of leads' });
    await page.waitForURL(/m=count/);
    await page.getByLabel('Group by').selectOption({ label: 'Intake' });
    await page.waitForURL(/g=cf%3Aintake/);
    await expect(page.getByRole('heading', { name: 'Custom report' })).toBeVisible();
    const row = (name: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
    await expect(row('May')).toContainText('3');
    await expect(row('Jan')).toContainText('1');
    await expect(row('Sept')).toContainText('1');

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).click()]);
    const text = readFileSync((await download.path())!, 'utf8');
    expect(text.split('\n').slice(0, 2)).toEqual(['Intake,Number of leads', 'May,3']);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Leads by intake');
    await page.getByRole('dialog').getByRole('button', { name: 'Save report' }).click();
    await page.waitForURL(/r=c/);
    await expect(page.getByRole('heading', { name: 'Leads by intake' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Reports' }).getByRole('link', { name: 'Leads by intake' })).toBeVisible();
  });

  test('on Starter: ready-made reports work, building and editing custom fields are locked, values stay visible', async () => {
    await q(`UPDATE "Subscription" SET status = 'active', plan = 'starter', "trialEndsAt" = NULL, "currentPeriodEnd" = now() + interval '30 days' WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = $1)`, [slug]);
    await page.goto(`/${slug}/reports?r=lead-sources&p=all`);
    await expect(page.getByText('Build your own reports with the Pro plan')).toBeVisible();
    await expect(page.getByLabel('Group by')).toBeDisabled();
    await expect(page.getByLabel('Period')).toBeEnabled();
    await page.goto(`/${slug}/settings?tab=fields`);
    await expect(page.getByText('Custom fields & report builder is part of the Pro plan')).toBeVisible();
    await page.goto(leadUrl);
    await expect(page.getByText('12,50,000')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
    await expect(page.getByText('Editing custom fields is part of the Pro plan')).toBeVisible();
  });

  test('no browser console errors', async () => {
    expect(consoleErrors).toEqual([]);
  });
});
