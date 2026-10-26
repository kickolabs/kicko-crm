import { libraryExport } from '@/server/admin-library';

/** Download the library as library.json, to copy reviewed edits back into the pack's source. */
export async function GET(req: Request) {
  const pack = new URL(req.url).searchParams.get('pack') ?? 'immigration';
  const body = JSON.stringify(await libraryExport(pack), null, 1);
  return new Response(body, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${pack}-library.json"` },
  });
}
