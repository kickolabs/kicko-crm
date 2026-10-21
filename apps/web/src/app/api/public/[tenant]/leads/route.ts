import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { createLead } from '@/server/leads';
import { publicScope, rateLimit } from '@/server/public';
import { UserError } from '@/server/scope';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Form-Key',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

/** Public lead capture: website backends, landing pages, Zapier/Make. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`api:${tenant}:${ip}`, 20)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: cors });
  }
  const scope = await publicScope(tenant, req.headers.get('x-form-key') ?? req.nextUrl.searchParams.get('k'));
  if (!scope) return NextResponse.json({ error: 'Unknown workspace or key' }, { status: 401, headers: cors });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send a JSON body' }, { status: 400, headers: cors });
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  try {
    const res = await createLead(
      scope,
      {
        firstName: str(body.firstName) ?? '',
        lastName: str(body.lastName),
        email: str(body.email),
        phone: str(body.phone),
        interestCountry: str(body.interestCountry),
        interestCategory: str(body.interestCategory) as never,
        message: str(body.message),
        source: (str(body.source) as never) ?? 'WEB_FORM',
        waOptIn: body.waOptIn === true,
      },
      { mergeDuplicates: true, utm: typeof body.utm === 'object' && body.utm ? (body.utm as Record<string, string>) : undefined },
    );
    return NextResponse.json(
      res.status === 'created' ? { ok: true, ref: res.ref } : { ok: true, merged: true },
      { status: res.status === 'created' ? 201 : 200, headers: cors },
    );
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Invalid lead', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 422, headers: cors });
    }
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 422, headers: cors });
    console.error(err);
    return NextResponse.json({ error: 'Server error' }, { status: 500, headers: cors });
  }
}
