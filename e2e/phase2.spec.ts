import { expect, test, type Page } from '@playwright/test';
import { testMobile, verifyMobile } from './helpers';

// Phase 2 journey: documents (upload → reject → re-upload → verify), partner
// institution + course, study application → enrolled → commission claim,
// service package → invoice with installments → payment → receipt PDF, cron & webhook guards.

const run = Date.now().toString(36);
const slug = `p2-${run}`;
const pdf = (label: string) => ({
  name: `${label}.pdf`,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF ${label}`),
});

test.describe.serial('Phase 2', () => {
  let page: Page;
  let caseUrl = '';

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Owner Two');
    await page.getByLabel('Work email').fill(`p2-${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('kicko-pass-123');
    await page.getByLabel('Confirm password').fill('kicko-pass-123');
    await page.getByLabel('Mobile number').fill(testMobile());
    await page.getByLabel('Agency name').fill(`Phase Two ${run}`);
    await page.getByLabel('Workspace address').fill(slug);
    await page.getByRole('button', { name: 'Create account & workspace' }).click();
    await verifyMobile(page);
    await page.waitForURL(`**/${slug}`);

    // A study case to work on.
    await page.goto(`/${slug}/leads?new=1`);
    const d = page.getByRole('dialog');
    await d.getByLabel('First name').fill('Priya');
    await d.getByLabel('Last name').fill('Raman');
    await d.getByLabel('Phone / WhatsApp').fill('9840011223');
    await d.getByLabel('Visa product').selectOption({ label: 'Canada · Study Permit' });
    await d.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/leads\//);
    await page.getByRole('button', { name: 'Convert to client →' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
    await page.waitForURL(/\/cases\//);
    caseUrl = page.url();
  });

  test('case gets its document checklist automatically', async () => {
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
    await expect(page.getByText('0/13 required verified')).toBeVisible();
    await expect(page.getByText('Provincial attestation letter (PAL)')).toBeVisible();
  });

  test('upload → reject with reason → re-upload → verify with expiry', async () => {
    await page.getByLabel('Upload Passport (all pages)').setInputFiles(pdf('passport-v1'));
    await expect(page.getByText('passport-v1.pdf')).toBeVisible();
    await expect(page.getByText('1 to review')).toBeVisible();

    await page.getByRole('button', { name: 'Review' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.locator('iframe')).toBeVisible(); // signed preview URL
    await dlg.getByRole('button', { name: 'Reject' }).click();
    await dlg.getByLabel(/What needs fixing/).fill('Last page missing');
    await dlg.getByRole('button', { name: 'Reject & ask again' }).click();
    await expect(page.getByText('Fix: Last page missing')).toBeVisible();

    await page.getByLabel('Upload Passport (all pages)').setInputFiles(pdf('passport-v2'));
    await expect(page.getByText(/passport-v2\.pdf .* v2/)).toBeVisible();
    await page.getByRole('button', { name: 'Review' }).click();
    await page.getByRole('dialog').getByLabel('Expiry date (optional)').fill('2031-03-14');
    await page.getByRole('dialog').getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('1/13 required verified')).toBeVisible();
    await expect(page.getByText('Expires 14 Mar 2031')).toBeVisible();
  });

  test('mark a document not applicable', async () => {
    await page.getByLabel('Mark Sponsor affidavit of support not applicable').click();
    await expect(page.getByLabel('Restore Sponsor affidavit of support')).toBeVisible();
  });

  test('partner institution with a course', async () => {
    await page.goto(`/${slug}/partners/new`);
    await page.getByLabel('Name').fill('Seneca Polytechnic');
    await page.getByLabel('City').fill('Toronto');
    await page.getByLabel('Percent (%)').fill('15');
    await page.getByRole('button', { name: 'Add institution' }).click();
    await page.waitForURL(/\/partners\/[a-z0-9]+$/);
    await page.getByRole('button', { name: '+ Course' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Course').fill('PG Diploma Data Analytics');
    await d.getByLabel('Tuition per year (CAD)').fill('18950');
    await d.getByLabel('Intakes').fill('Jan, Sep');
    await d.getByRole('button', { name: 'Add course' }).click();
    await expect(page.getByText('PG Diploma Data Analytics')).toBeVisible();
  });

  test('enrolling an application raises the commission claim', async () => {
    await page.goto(caseUrl);
    await page.getByRole('button', { name: 'Application', exact: true }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Course', { exact: true }).selectOption({ label: 'PG Diploma Data Analytics · PG Diploma' });
    await d.getByLabel('Intake').fill('Jan 2027');
    await d.getByRole('button', { name: 'Add application' }).click();
    await expect(page.getByText('Jan 2027 · CA$18,950/yr')).toBeVisible();
    await page.getByLabel('Status for Seneca Polytechnic').selectOption('ENROLLED');
    await expect(page.getByText('Commission CA$2,842.50 · expected')).toBeVisible();

    await page.goto(`/${slug}/partners/commissions`);
    await expect(page.getByRole('cell', { name: /CA\$2,842\.50/ })).toBeVisible();
    await page.getByRole('button', { name: 'Update' }).click();
    await page.getByRole('dialog').getByLabel('Status').selectOption('CLAIMED');
    await page.getByRole('dialog').getByLabel('Our claim / invoice ref').fill('CLM-001');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('CLM-001')).toBeVisible();
  });

  test('package → invoice with installments → payment → receipt', async () => {
    await page.goto(`/${slug}/settings?tab=billing`);
    await page.getByLabel('GSTIN').fill('33ABCDE1234F1Z5');
    await page.getByLabel('UPI ID').fill('agency@okhdfc');
    await page.getByRole('button', { name: 'Save billing details' }).click();
    await expect(page.getByText('Saved. New invoices')).toBeVisible();

    await page.getByRole('button', { name: '+ Package' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Name').fill('Canada study: full service');
    await d.getByLabel('Price before tax (₹)').fill('50000');
    await d.getByRole('button', { name: 'Save package' }).click();
    await expect(page.getByText('₹50,000')).toBeVisible();

    await page.goto(caseUrl);
    await page.getByRole('link', { name: '+ Invoice' }).click();
    await page.waitForURL(/billing\/new/);
    await page.getByRole('button', { name: /Canada study: full service/ }).click();
    await expect(page.getByText('₹59,000').first()).toBeVisible(); // 50,000 + 18% GST
    await page.getByRole('button', { name: 'Create & issue invoice' }).click();
    await page.waitForURL(/\/billing\/[a-z0-9]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/INV\/\d{2}-\d{2}\/0001/);
    await expect(page.getByText('CGST')).toBeVisible();
    await expect(page.getByText('On signing')).toBeVisible(); // default 50/30/20 plan

    await page.getByRole('button', { name: 'Record payment' }).click();
    const pay = page.getByRole('dialog');
    await pay.getByLabel('Amount (₹)').fill('29500');
    await pay.getByLabel('Reference').fill('UTR123456');
    await pay.getByRole('button', { name: 'Record & issue receipt' }).click();
    await expect(page.getByText('Part paid')).toBeVisible();
    await expect(page.getByText(/RCPT\/\d{2}-\d{2}\/0001/)).toBeVisible();

    const receiptHref = await page.getByRole('link', { name: 'Receipt PDF' }).getAttribute('href');
    const receipt = await page.request.get(receiptHref!);
    expect(receipt.status()).toBe(200);
    expect(receipt.headers()['content-type']).toBe('application/pdf');
    expect((await receipt.body()).subarray(0, 4).toString()).toBe('%PDF');

    const inv = await page.request.get(await page.getByRole('link', { name: 'PDF', exact: true }).getAttribute('href') as string);
    expect(inv.status()).toBe(200);

    // Overpayment is refused.
    await page.getByRole('button', { name: 'Record payment' }).click();
    await page.getByRole('dialog').getByLabel('Amount (₹)').fill('99999');
    await page.getByRole('dialog').getByRole('button', { name: 'Record & issue receipt' }).click();
    await expect(page.getByRole('dialog').getByText(/more than the balance due/)).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto(`/${slug}/billing`);
    await expect(page.getByText('₹29,500').first()).toBeVisible();
  });

  test('signed Razorpay webhook marks the invoice paid, exactly once', async ({ request }) => {
    // Connect (test) keys through the UI; secrets are stored encrypted.
    await page.goto(`/${slug}/settings?tab=billing`);
    await page.getByRole('button', { name: 'Set up' }).click();
    await page.getByLabel('Key ID').fill('rzp_test_e2e123');
    await page.getByLabel('Key secret').fill('secret_e2e');
    await page.getByLabel('Webhook secret').fill('whsec_e2e');
    await page.getByRole('button', { name: 'Connect Razorpay' }).click();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();

    // Simulate the link Razorpay would have created for the remaining balance.
    const { Client } = await import('pg');
    const db = new Client('postgresql://postgres:postgres@localhost:5433/kicko');
    await db.connect();
    const { rows } = await db.query(
      `SELECT i.id, i."tenantId", i.total - i."amountPaid" AS due FROM "Invoice" i JOIN "Tenant" t ON t.id = i."tenantId" WHERE t.slug = $1`,
      [slug],
    );
    const inv = rows[0]!;
    const linkId = `plink_e2e_${run}`;
    await db.query(
      `INSERT INTO "PaymentLink" (id, "tenantId", "invoiceId", provider, "providerId", url, amount) VALUES ($1, $2, $3, 'RAZORPAY', $4, 'https://rzp.io/x', $5)`,
      [`pl_${run}`, inv.tenantId, inv.id, linkId, inv.due],
    );

    const { createHmac } = await import('node:crypto');
    const body = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: linkId, status: 'paid', amount_paid: Number(inv.due), reference_id: 'x' } },
        payment: { entity: { id: `pay_e2e_${run}`, amount: Number(inv.due), method: 'upi', created_at: Math.floor(Date.now() / 1000) } },
      },
    });
    const send = () =>
      request.post(`/api/webhooks/payments/razorpay/${slug}`, {
        data: body,
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', 'whsec_e2e').update(body).digest('hex') },
      });
    expect((await send()).status()).toBe(200);
    expect((await send()).status()).toBe(200); // Razorpay retries: must not double-count

    const after = await db.query(`SELECT status, "amountPaid", total, (SELECT count(*) FROM "Payment" p WHERE p."invoiceId" = i.id) AS n FROM "Invoice" i WHERE id = $1`, [inv.id]);
    await db.end();
    expect(after.rows[0]).toMatchObject({ status: 'PAID', n: '2' });
    expect(after.rows[0].amountPaid).toBe(after.rows[0].total);
  });

  test('cron and webhook endpoints reject unauthenticated calls', async ({ request }) => {
    expect((await request.get('/api/cron/daily')).status()).toBe(401);
    expect((await request.get('/api/cron/daily', { headers: { Authorization: 'Bearer wrong' } })).status()).toBe(401);
    const hook = await request.post(`/api/webhooks/payments/razorpay/${slug}`, {
      data: { event: 'payment_link.paid' },
      headers: { 'x-razorpay-signature': 'forged' },
    });
    expect(hook.status()).toBe(401);
  });

  test('download links are signed and expire-checked', async ({ request }) => {
    expect((await request.get('/api/files/download?t=forged.token')).status()).toBe(403);
    expect((await request.put('/api/files/upload?t=forged.token', { data: 'x' })).status()).toBe(403);
  });
});
