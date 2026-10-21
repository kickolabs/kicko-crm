import { NextResponse } from 'next/server';
import { can } from '@/lib/permissions';
import { getCtx } from '@/lib/tenant';
import { exportAll } from '@/server/export';
import { scopeOf, UserError } from '@/server/scope';

// Owners and admins download everything the agency has in Kicko, even when the
// workspace is read-only or suspended.
export async function GET(_: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const ctx = await getCtx(tenant);
  if (!can(ctx.role, 'settings.manage')) return NextResponse.json({ error: 'Only owners and admins can export data' }, { status: 403 });
  try {
    const { zip, fileName } = await exportAll({ ...scopeOf(ctx), tenantName: ctx.tenant.name });
    return new NextResponse(zip as unknown as BodyInit, {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 429 });
    throw err;
  }
}
