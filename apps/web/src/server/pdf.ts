import 'server-only';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { computeInvoice, formatMoney, type TaxMode } from '@/lib/money';
import { rupeesInWords } from '@/lib/words';

// Server-rendered A4 PDFs for invoices and receipts, in the Kicko paper style.

const INK = rgb(0.071, 0.078, 0.09);
const MUTED = rgb(0.353, 0.376, 0.412);
const LINE = rgb(0.88, 0.88, 0.86);
const LIME = rgb(0.784, 1, 0.239);
const PAPER = rgb(0.957, 0.953, 0.933);

function fontPath(file: string) {
  for (const base of [path.join(process.cwd(), 'node_modules'), path.join(process.cwd(), '../../node_modules')]) {
    const p = path.join(base, '@fontsource/plus-jakarta-sans/files', file);
    if (existsSync(p)) return p;
  }
  throw new Error(`Font not found: ${file}`);
}

type Fonts = { reg: PDFFont; bold: PDFFont; regX: PDFFont; boldX: PDFFont };

async function setup() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const load = (f: string) => readFile(fontPath(f)).then((b) => doc.embedFont(b, { subset: true }));
  const [reg, bold, regX, boldX] = await Promise.all([
    load('plus-jakarta-sans-latin-400-normal.woff'),
    load('plus-jakarta-sans-latin-800-normal.woff'),
    load('plus-jakarta-sans-latin-ext-400-normal.woff'),
    load('plus-jakarta-sans-latin-ext-800-normal.woff'),
  ]);
  return { doc, fonts: { reg, bold, regX, boldX } as Fonts };
}

/** Draws text, switching to the latin-ext font for glyphs the latin subset lacks (e.g. ₹). */
class Writer {
  constructor(
    private page: PDFPage,
    private f: Fonts,
  ) {}

  private runs(text: string, bold: boolean) {
    const main = bold ? this.f.bold : this.f.reg;
    const ext = bold ? this.f.boldX : this.f.regX;
    const out: { t: string; font: PDFFont }[] = [];
    for (const ch of text) {
      const font = ch === '₹' ? ext : main;
      const last = out[out.length - 1];
      if (last && last.font === font) last.t += ch;
      else out.push({ t: ch, font });
    }
    return out;
  }

  width(text: string, size: number, bold = false) {
    return this.runs(text, bold).reduce((w, r) => w + r.font.widthOfTextAtSize(r.t, size), 0);
  }

  text(text: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: 'left' | 'right' } = {}) {
    const size = o.size ?? 10;
    let cx = o.align === 'right' ? x - this.width(text, size, o.bold) : x;
    for (const r of this.runs(text, Boolean(o.bold))) {
      this.page.drawText(r.t, { x: cx, y, size, font: r.font, color: o.color ?? INK });
      cx += r.font.widthOfTextAtSize(r.t, size);
    }
  }

  /** Wrapped paragraph; returns the y below it. */
  para(text: string, x: number, y: number, maxW: number, o: { size?: number; color?: ReturnType<typeof rgb>; lineGap?: number } = {}) {
    const size = o.size ?? 9;
    const lh = size * (o.lineGap ?? 1.45);
    for (const raw of text.split('\n')) {
      let line = '';
      for (const word of raw.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (this.width(next, size) > maxW && line) {
          this.text(line, x, y, { size, color: o.color });
          y -= lh;
          line = word;
        } else line = next;
      }
      this.text(line, x, y, { size, color: o.color });
      y -= lh;
    }
    return y;
  }
}

export type PdfAgency = {
  name: string;
  legalName?: string;
  address?: string;
  gstin?: string;
  pan?: string;
  bankDetails?: string;
  upiId?: string;
  terms?: string;
};

export type PdfClient = { name: string; ref: string; address?: string | null; phone?: string | null; email?: string | null };

const fmtD = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz }).format(d);

function header(w: Writer, page: PDFPage, agency: PdfAgency, title: string, number: string) {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: LIME });
  // Logo mark
  page.drawRectangle({ x: 48, y: height - 92, width: 30, height: 30, color: INK });
  page.drawLine({ start: { x: 56, y: height - 70 }, end: { x: 56, y: height - 84 }, thickness: 2.2, color: LIME });
  page.drawLine({ start: { x: 56, y: height - 77 }, end: { x: 66, y: height - 68 }, thickness: 2.2, color: LIME });
  page.drawLine({ start: { x: 60, y: height - 74 }, end: { x: 70, y: height - 85 }, thickness: 2.2, color: LIME });

  w.text(agency.legalName || agency.name, 88, height - 74, { size: 13, bold: true });
  let y = height - 88;
  if (agency.address) y = w.para(agency.address, 88, y, 250, { size: 8.5, color: MUTED });
  const ids = [agency.gstin && `GSTIN ${agency.gstin}`, agency.pan && `PAN ${agency.pan}`].filter(Boolean).join('   ·   ');
  if (ids) w.text(ids, 88, y, { size: 8.5, color: MUTED });

  w.text(title, width - 48, height - 76, { size: 22, bold: true, align: 'right' });
  w.text(number, width - 48, height - 92, { size: 10, color: MUTED, align: 'right' });
  return Math.min(y, height - 100) - 24;
}

function partyBlock(w: Writer, x: number, y: number, label: string, client: PdfClient) {
  w.text(label.toUpperCase(), x, y, { size: 7.5, bold: true, color: MUTED });
  w.text(client.name, x, y - 15, { size: 11, bold: true });
  let yy = y - 29;
  for (const line of [client.ref, client.phone, client.email].filter(Boolean) as string[]) {
    w.text(line, x, yy, { size: 9, color: MUTED });
    yy -= 12;
  }
  if (client.address) yy = w.para(client.address, x, yy, 220, { size: 9, color: MUTED });
  return yy;
}

function meta(w: Writer, xRight: number, y: number, rows: [string, string][]) {
  for (const [k, v] of rows) {
    w.text(k, xRight - 150, y, { size: 9, color: MUTED });
    w.text(v, xRight, y, { size: 9, bold: true, align: 'right' });
    y -= 14;
  }
  return y;
}

function footer(w: Writer, page: PDFPage, agency: PdfAgency) {
  const { width } = page.getSize();
  page.drawLine({ start: { x: 48, y: 62 }, end: { x: width - 48, y: 62 }, thickness: 0.6, color: LINE });
  w.text(`${agency.name} · This is a computer-generated document and does not require a signature.`, 48, 46, { size: 7.5, color: MUTED });
  w.text('Kicko', width - 48, 46, { size: 7.5, bold: true, color: MUTED, align: 'right' });
}

export async function renderInvoicePdf(input: {
  tz: string;
  agency: PdfAgency;
  client: PdfClient;
  invoice: {
    ref: string;
    status: string;
    issueDate: Date;
    taxMode: TaxMode;
    currency: string;
    amountPaid: number;
    notes?: string | null;
    caseRef?: string | null;
    items: { description: string; quantity: number; unitPrice: number; taxRate: number }[];
    installments: { label: string; amount: number; paidAmount: number; dueDate: Date }[];
  };
}) {
  const { doc, fonts } = await setup();
  const page = doc.addPage([595.28, 841.89]);
  const w = new Writer(page, fonts);
  const { width } = page.getSize();
  const R = width - 48;
  const inv = input.invoice;
  const cur = (n: number) => formatMoney(n, inv.currency);
  const totals = computeInvoice(inv.items, inv.taxMode);

  let y = header(w, page, input.agency, inv.status === 'DRAFT' ? 'DRAFT INVOICE' : 'TAX INVOICE', inv.ref);
  const yParty = partyBlock(w, 48, y, 'Bill to', input.client);
  const yMeta = meta(w, R, y, [
    ['Invoice date', fmtD(inv.issueDate, input.tz)],
    ...(inv.caseRef ? ([['Case', inv.caseRef]] as [string, string][]) : []),
    ['Place of supply', inv.taxMode === 'GST_INTER' ? 'Inter-state' : inv.taxMode === 'GST_INTRA' ? 'Intra-state' : '—'],
    ['Status', inv.status.replace('_', ' ').toLowerCase()],
  ]);
  y = Math.min(yParty, yMeta) - 18;

  // Items table
  page.drawRectangle({ x: 48, y: y - 6, width: R - 48, height: 22, color: PAPER });
  const cols = { desc: 58, qty: 330, rate: 400, tax: 450, amt: R - 10 };
  w.text('DESCRIPTION', cols.desc, y, { size: 7.5, bold: true, color: MUTED });
  w.text('QTY', cols.qty, y, { size: 7.5, bold: true, color: MUTED, align: 'right' });
  w.text('RATE', cols.rate, y, { size: 7.5, bold: true, color: MUTED, align: 'right' });
  w.text('GST', cols.tax, y, { size: 7.5, bold: true, color: MUTED, align: 'right' });
  w.text('AMOUNT', cols.amt, y, { size: 7.5, bold: true, color: MUTED, align: 'right' });
  y -= 26;
  for (const it of totals.items) {
    const yStart = y;
    const yEnd = w.para(it.description, cols.desc, y, 250, { size: 9.5 });
    w.text(String(it.quantity), cols.qty, yStart, { size: 9.5, align: 'right' });
    w.text(cur(it.unitPrice), cols.rate, yStart, { size: 9.5, align: 'right' });
    w.text(inv.taxMode === 'NONE' ? '—' : `${it.taxRate / 100}%`, cols.tax, yStart, { size: 9.5, align: 'right' });
    w.text(cur(it.amount), cols.amt, yStart, { size: 9.5, bold: true, align: 'right' });
    y = yEnd - 6;
    page.drawLine({ start: { x: 48, y: y + 8 }, end: { x: R, y: y + 8 }, thickness: 0.5, color: LINE });
  }

  // Totals
  y -= 6;
  const tot: [string, string, boolean?][] = [['Subtotal', cur(totals.subtotal)]];
  if (inv.taxMode === 'GST_INTRA') tot.push(['CGST', cur(totals.cgst)], ['SGST', cur(totals.sgst)]);
  if (inv.taxMode === 'GST_INTER') tot.push(['IGST', cur(totals.igst)]);
  for (const [k, v] of tot) {
    w.text(k, R - 160, y, { size: 9.5, color: MUTED });
    w.text(v, R - 10, y, { size: 9.5, align: 'right' });
    y -= 15;
  }
  y -= 14; // clear the last tax line before the total bar
  page.drawRectangle({ x: R - 175, y: y - 10, width: 175, height: 28, color: INK });
  w.text('Total', R - 160, y, { size: 11, bold: true, color: rgb(0.96, 0.95, 0.93) });
  w.text(cur(totals.total), R - 10, y, { size: 12, bold: true, color: LIME, align: 'right' });
  y -= 30;
  if (inv.amountPaid > 0) {
    w.text('Paid', R - 160, y, { size: 9.5, color: MUTED });
    w.text(cur(inv.amountPaid), R - 10, y, { size: 9.5, align: 'right' });
    y -= 15;
    w.text('Balance due', R - 160, y, { size: 9.5, bold: true });
    w.text(cur(totals.total - inv.amountPaid), R - 10, y, { size: 9.5, bold: true, align: 'right' });
    y -= 15;
  }
  if (inv.currency === 'INR') {
    y = w.para(rupeesInWords(totals.total), 48, y - 4, 300, { size: 8.5, color: MUTED });
  }

  // Installments
  if (inv.installments.length > 1) {
    y -= 14;
    w.text('PAYMENT SCHEDULE', 48, y, { size: 7.5, bold: true, color: MUTED });
    y -= 16;
    for (const s of inv.installments) {
      const state = s.paidAmount >= s.amount ? 'Paid' : s.paidAmount > 0 ? `Part paid ${cur(s.paidAmount)}` : `Due ${fmtD(s.dueDate, input.tz)}`;
      w.text(s.label, 48, y, { size: 9.5 });
      w.text(state, 330, y, { size: 9, color: MUTED });
      w.text(cur(s.amount), R - 10, y, { size: 9.5, bold: true, align: 'right' });
      y -= 15;
    }
  }

  // Payment details & notes
  const pay = [input.agency.upiId && `UPI: ${input.agency.upiId}`, input.agency.bankDetails].filter(Boolean).join('\n');
  if (pay) {
    y -= 14;
    w.text('HOW TO PAY', 48, y, { size: 7.5, bold: true, color: MUTED });
    y = w.para(pay, 48, y - 14, 300, { size: 9 });
  }
  const notes = [inv.notes, input.agency.terms].filter(Boolean).join('\n\n');
  if (notes) {
    y -= 10;
    w.text('NOTES', 48, y, { size: 7.5, bold: true, color: MUTED });
    w.para(notes, 48, y - 14, R - 48, { size: 8.5, color: MUTED });
  }
  footer(w, page, input.agency);
  return doc.save();
}

export async function renderReceiptPdf(input: {
  tz: string;
  agency: PdfAgency;
  client: PdfClient;
  payment: { receiptRef: string; amount: number; method: string; reference?: string | null; paidAt: Date };
  invoice: { ref: string; total: number; amountPaid: number; currency: string };
}) {
  const { doc, fonts } = await setup();
  const page = doc.addPage([595.28, 841.89]);
  const w = new Writer(page, fonts);
  const R = page.getSize().width - 48;
  const cur = (n: number) => formatMoney(n, input.invoice.currency);
  const p = input.payment;

  let y = header(w, page, input.agency, 'RECEIPT', p.receiptRef);
  const yParty = partyBlock(w, 48, y, 'Received from', input.client);
  const yMeta = meta(w, R, y, [
    ['Date', fmtD(p.paidAt, input.tz)],
    ['Against invoice', input.invoice.ref],
    ['Method', p.method.replace('_', ' ').toLowerCase()],
    ...(p.reference ? ([['Reference', p.reference.slice(0, 30)]] as [string, string][]) : []),
  ]);
  y = Math.min(yParty, yMeta) - 30;

  page.drawRectangle({ x: 48, y: y - 52, width: R - 48, height: 76, color: INK });
  w.text('AMOUNT RECEIVED', 66, y, { size: 8, bold: true, color: rgb(0.66, 0.69, 0.72) });
  w.text(cur(p.amount), 66, y - 34, { size: 28, bold: true, color: LIME });
  if (input.invoice.currency === 'INR') w.text(rupeesInWords(p.amount), R - 18, y - 34, { size: 8.5, color: rgb(0.77, 0.79, 0.82), align: 'right' });
  y -= 90;
  for (const [k, v] of [
    ['Invoice total', cur(input.invoice.total)],
    ['Paid to date', cur(input.invoice.amountPaid)],
    ['Balance due', cur(input.invoice.total - input.invoice.amountPaid)],
  ] as const) {
    w.text(k, 48, y, { size: 10, color: MUTED });
    w.text(v, R, y, { size: 10, bold: true, align: 'right' });
    y -= 18;
  }
  y -= 10;
  w.text('Thank you.', 48, y, { size: 14, bold: true });
  footer(w, page, input.agency);
  return doc.save();
}

// ── Government form data sheet ──────────────────────────────────────────────

/** The embedded fonts cover Latin scripts; anything else is replaced rather than breaking the PDF. */
const latin = (s: string) => s.replace(/[^\u0000-ɏ‐-‧₹]/g, '?');

export async function renderFormSheetPdf(input: {
  agency: string;
  form: { title: string; use: string };
  client: { name: string; ref: string };
  sections: { title: string; rows: { label: string; value: string | null }[] }[];
  generated: string;
}) {
  const { doc, fonts } = await setup();
  let page = doc.addPage([595.28, 841.89]);
  let w = new Writer(page, fonts);
  const { width, height } = page.getSize();
  const left = 48;
  const valueX = 250;
  const valueW = width - left - valueX;

  const top = () => {
    page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: LIME });
    w.text(input.agency, left, height - 40, { size: 9, bold: true, color: MUTED });
    w.text(`${input.client.name} · ${input.client.ref}`, width - left, height - 40, { size: 9, color: MUTED, align: 'right' });
    return height - 64;
  };
  const newPage = () => {
    page = doc.addPage([595.28, 841.89]);
    w = new Writer(page, fonts);
    return top();
  };

  let y = top();
  w.text(latin(input.form.title), left, y, { size: 18, bold: true });
  y = w.para(latin(input.form.use), left, y - 16, width - left * 2, { size: 8.5, color: MUTED }) - 6;
  w.text(`Prepared ${input.generated} from the client's file. Check every answer against the original documents before submitting.`, left, y, { size: 8, color: MUTED });
  y -= 22;

  for (const s of input.sections) {
    if (y < 120) y = newPage();
    page.drawRectangle({ x: left, y: y - 4, width: width - left * 2, height: 18, color: PAPER });
    w.text(latin(s.title.toUpperCase()), left + 8, y + 1, { size: 8, bold: true });
    y -= 24;
    for (const r of s.rows) {
      const value = latin(r.value ?? '(missing)');
      const lines = Math.max(1, value.split('\n').length + Math.floor(w.width(value, 9) / valueW));
      if (y - lines * 13 < 70) y = newPage();
      w.text(latin(r.label), left, y, { size: 8.5, color: MUTED });
      const end = w.para(value, valueX, y, valueW, { size: 9, color: r.value ? INK : MUTED });
      y = Math.min(end, y - 13) - 4;
      page.drawLine({ start: { x: left, y: y + 6 }, end: { x: width - left, y: y + 6 }, thickness: 0.4, color: LINE });
    }
    y -= 8;
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => new Writer(p, fonts).text(`${i + 1} / ${pages.length}`, width - left, 30, { size: 7.5, color: MUTED, align: 'right' }));
  return Buffer.from(await doc.save());
}

// ── Kicko's own tax invoice to an agency ────────────────────────────────────

export async function renderPlatformInvoicePdf(input: {
  seller: { legalName: string; address: string; gstin: string };
  buyer: { name: string; address?: string; gstin?: string };
  invoice: { number: string; date: string; description: string; sac: string; subtotal: number; cgst: number; sgst: number; igst: number; total: number; currency: string };
}) {
  const { doc, fonts } = await setup();
  const page = doc.addPage([595.28, 841.89]);
  const w = new Writer(page, fonts);
  const { width } = page.getSize();
  const i = input.invoice;
  let y = header(w, page, { name: 'Kicko', legalName: input.seller.legalName, address: input.seller.address, gstin: input.seller.gstin }, 'TAX INVOICE', i.number);
  partyBlock(w, 48, y, 'Billed to', { name: input.buyer.name, ref: input.buyer.gstin ? `GSTIN ${input.buyer.gstin}` : 'Unregistered', address: input.buyer.address });
  meta(w, width - 48, y, [['Invoice date', i.date], ['Status', 'Paid']]);
  y -= 110;
  page.drawRectangle({ x: 48, y: y - 6, width: width - 96, height: 22, color: PAPER });
  w.text('DESCRIPTION', 56, y, { size: 7.5, bold: true, color: MUTED });
  w.text('SAC', 380, y, { size: 7.5, bold: true, color: MUTED });
  w.text('AMOUNT', width - 56, y, { size: 7.5, bold: true, color: MUTED, align: 'right' });
  y -= 26;
  w.para(i.description, 56, y, 300, { size: 10 });
  w.text(i.sac, 380, y, { size: 10 });
  w.text(formatMoney(i.subtotal, i.currency), width - 56, y, { size: 10, align: 'right' });
  y -= 40;
  const rows: [string, number][] = [['Taxable value', i.subtotal]];
  if (i.cgst) rows.push(['CGST @ 9%', i.cgst], ['SGST @ 9%', i.sgst]);
  if (i.igst) rows.push(['IGST @ 18%', i.igst]);
  for (const [k, v] of rows) {
    w.text(k, width - 220, y, { size: 9.5, color: MUTED });
    w.text(formatMoney(v, i.currency), width - 56, y, { size: 9.5, align: 'right' });
    y -= 16;
  }
  page.drawRectangle({ x: width - 236, y: y - 8, width: 188, height: 26, color: INK });
  w.text('Total paid', width - 226, y, { size: 10, bold: true, color: PAPER });
  w.text(formatMoney(i.total, i.currency), width - 56, y, { size: 11, bold: true, color: LIME, align: 'right' });
  footer(w, page, { name: input.seller.legalName });
  return Buffer.from(await doc.save());
}

// ─── Generated documents (agreements, letters) ─────────────────────────────

export type PdfSignature = { name: string; at: string; ip?: string | null; hash: string };

/**
 * A template-generated document as an A4 PDF: the agency's letterhead, the blocks of the
 * rendered template, and, once signed, the signature block with its audit details.
 */
export async function documentPdf(o: { agency: PdfAgency; title: string; blocks: { kind: string; text: string }[]; signature?: PdfSignature | null; tz: string }) {
  const { doc, fonts } = await setup();
  const W = 595.28;
  const H = 841.89;
  const M = 56;
  let page = doc.addPage([W, H]);
  let w = new Writer(page, fonts);
  let y = H - M;
  const header = () => {
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: LIME });
    w.text(o.agency.legalName ?? o.agency.name, M, y, { size: 11, bold: true });
    if (o.agency.address) w.text(o.agency.address.split('\n')[0]!, M, y - 14, { size: 8, color: MUTED });
    y -= 44;
  };
  const need = (h: number) => {
    if (y - h > M) return;
    page = doc.addPage([W, H]);
    w = new Writer(page, fonts);
    y = H - M;
    header();
  };
  header();
  const clean = (s: string) => s.replace(/\*\*/g, '');
  for (const b of o.blocks) {
    if (b.kind === 'h1') {
      need(40);
      w.text(clean(b.text), M, y, { size: 18, bold: true });
      y -= 30;
    } else if (b.kind === 'h2') {
      need(30);
      y -= 6;
      w.text(clean(b.text), M, y, { size: 11, bold: true });
      y -= 18;
    } else if (b.kind === 'li') {
      need(20);
      w.text('•', M + 2, y, { size: 9.5 });
      y = w.para(clean(b.text), M + 14, y, W - 2 * M - 14, { size: 9.5 }) - 2;
    } else if (b.kind === 'hr') {
      need(16);
      page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.6, color: LINE });
      y -= 14;
    } else if (b.kind === 'sign') {
      need(110);
      y -= 8;
      if (o.signature) {
        page.drawRectangle({ x: M, y: y - 74, width: W - 2 * M, height: 84, color: PAPER });
        w.text('Signed electronically', M + 12, y - 8, { size: 8, bold: true, color: MUTED });
        w.text(o.signature.name, M + 12, y - 30, { size: 16, bold: true });
        w.text(`${fmtD(new Date(o.signature.at), o.tz)} · ${new Date(o.signature.at).toISOString().replace('T', ' ').slice(0, 19)} UTC${o.signature.ip ? ` · IP ${o.signature.ip}` : ''}`, M + 12, y - 48, { size: 8, color: MUTED });
        w.text(`Document fingerprint (SHA-256): ${o.signature.hash}`, M + 12, y - 62, { size: 6.5, color: MUTED });
      } else {
        page.drawLine({ start: { x: M, y: y - 40 }, end: { x: M + 220, y: y - 40 }, thickness: 0.6, color: INK });
        w.text('Client signature and date', M, y - 54, { size: 8, color: MUTED });
      }
      y -= 96;
    } else {
      need(28);
      y = w.para(clean(b.text), M, y, W - 2 * M, { size: 9.5 }) - 6;
    }
  }
  return Buffer.from(await doc.save());
}

/**
 * Merge files into one PDF, in the given order: PDFs page by page, JPEG/PNG images one per
 * A4 page. Other types are listed on a cover page as left out.
 */
export async function mergeFiles(files: { name: string; contentType: string; data: Buffer }[], title: string) {
  const { doc, fonts } = await setup();
  const cover = doc.addPage([595.28, 841.89]);
  const w = new Writer(cover, fonts);
  w.text(title, 56, 780, { size: 18, bold: true });
  let y = 750;
  const skipped: string[] = [];
  for (const f of files) {
    try {
      if (f.contentType === 'application/pdf') {
        const src = await PDFDocument.load(f.data, { ignoreEncryption: true });
        for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
      } else if (f.contentType === 'image/jpeg' || f.contentType === 'image/png') {
        const img = f.contentType === 'image/png' ? await doc.embedPng(f.data) : await doc.embedJpg(f.data);
        const page = doc.addPage([595.28, 841.89]);
        const scale = Math.min((595.28 - 72) / img.width, (841.89 - 72) / img.height, 1);
        page.drawImage(img, { x: (595.28 - img.width * scale) / 2, y: (841.89 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
      } else {
        skipped.push(f.name);
        continue;
      }
      w.text(`• ${f.name}`, 56, y, { size: 9.5 });
      y -= 15;
    } catch {
      skipped.push(f.name);
    }
  }
  if (skipped.length) {
    y -= 10;
    w.text('Not included (open separately):', 56, y, { size: 9, bold: true, color: MUTED });
    for (const s of skipped) w.text(`• ${s}`, 56, (y -= 14), { size: 9, color: MUTED });
  }
  return Buffer.from(await doc.save());
}
