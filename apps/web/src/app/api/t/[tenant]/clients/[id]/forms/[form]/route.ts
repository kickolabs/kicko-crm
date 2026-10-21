import { NextResponse } from 'next/server';
import { fmtDate } from '@/lib/format';
import { getCtx } from '@/lib/tenant';
import { clientSheet } from '@/server/forms';
import { renderFormSheetPdf } from '@/server/pdf';
import { scopeOf, UserError } from '@/server/scope';

// Download a form's answer sheet as PDF (staff only; getCtx enforces membership).
export async function GET(_: Request, { params }: { params: Promise<{ tenant: string; id: string; form: string }> }) {
  const { tenant, id, form } = await params;
  const ctx = await getCtx(tenant);
  try {
    const { sheet, client } = await clientSheet(scopeOf(ctx), id, form);
    const bytes = await renderFormSheetPdf({
      agency: ctx.tenant.name,
      form: sheet.form,
      client: { name: [client.firstName, client.lastName].filter(Boolean).join(' '), ref: client.ref },
      sections: sheet.sections,
      generated: fmtDate(new Date(), ctx.tenant.timezone),
    });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${client.ref}-${form}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
