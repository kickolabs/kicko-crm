import { NextResponse } from 'next/server';
import { can } from '@/lib/permissions';
import { db, getCtx } from '@/lib/tenant';
import { mergeFiles } from '@/server/pdf';
import { getObject } from '@/server/storage';
import { audit } from '@/server/audit';

/** The case's current documents (latest file each, checklist order) as one PDF: for review or a print file. */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  const ctx = await getCtx(tenant);
  if (!can(ctx.role, 'case.write') && !can(ctx.role, 'document.verify')) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const onlyVerified = new URL(req.url).searchParams.get('verified') === '1';
  const c = await db(ctx, (tx) =>
    tx.case.findUnique({
      where: { id },
      include: {
        client: { select: { firstName: true, lastName: true } },
        documents: {
          where: { status: onlyVerified ? 'VERIFIED' : { in: ['UPLOADED', 'VERIFIED'] } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: { files: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
      },
    }),
  );
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const files = c.documents.flatMap((d) => d.files.map((f) => ({ name: `${d.group} · ${d.name}`, contentType: f.contentType, key: f.storageKey })));
  if (!files.length) return NextResponse.json({ error: 'No documents uploaded yet' }, { status: 404 });
  const loaded = await Promise.all(files.map(async (f) => ({ ...f, data: await getObject(f.key) })));
  const name = [c.client.firstName, c.client.lastName].filter(Boolean).join(' ');
  const pdf = await mergeFiles(loaded, `${c.ref} · ${name} · ${onlyVerified ? 'verified documents' : 'documents'}`);
  await audit({ tenantId: ctx.tenant.id, actorId: ctx.user.id }, 'document.bundle', `Downloaded ${c.ref} documents as one PDF (${files.length} files)`);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${c.ref}-documents.pdf"`, 'Cache-Control': 'private, no-store' },
  });
}
