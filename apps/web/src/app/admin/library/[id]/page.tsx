import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPack } from '@kicko/packs';
import { Badge, Card, CardHeader } from '@/components/ui';
import { getLibraryItem } from '@/server/admin-library';
import { LibraryItemForm, StatusButton, VerifyForm } from '../library-forms';

export const metadata = { title: 'Library item' };

export default async function LibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getLibraryItem(id);
  if (!item) notFound();
  const pack = getPack(item.packId);
  const def = pack.libraryTypes[item.type];
  const sources = (item.sources as { url: string; title?: string; verifiedAt?: string; official?: boolean }[]) ?? [];
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/admin/library?pack=${pack.id}&type=${item.type}`} className="text-xs font-semibold text-muted hover:text-ink">← {def?.plural ?? item.type}</Link>
          <h1 className="text-[28px] font-extrabold tracking-tight">{item.name}</h1>
          <p className="text-sm text-muted">
            <span className="font-mono">{item.key}</span> · version {item.version} · {item.status}
            {item.lastReviewedAt ? ` · reviewed ${item.lastReviewedAt.toISOString().slice(0, 10)}` : ' · never reviewed'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {item.unverified && <Badge tone="warn">Partly verified</Badge>}
          <StatusButton id={item.id} status={item.status} />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-5">
          <LibraryItemForm
            id={item.id}
            name={item.name}
            parentKey={item.parentKey}
            coverage={item.coverage}
            unverified={item.unverified}
            data={JSON.stringify(item.data, null, 2)}
            sources={JSON.stringify(item.sources, null, 2)}
            parentType={def?.parent}
          />
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Verify" sub="Open each official source and check the facts." />
            <ul className="flex flex-col gap-1.5 px-5 text-sm">
              {sources.length === 0 && <li className="text-muted">No sources yet: add them before marking verified.</li>}
              {sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{s.title ?? new URL(s.url).hostname}</a>
                  <span className="text-xs text-muted"> {s.official === false ? '· not official' : ''}{s.verifiedAt ? ` · ${s.verifiedAt}` : ''}</span>
                </li>
              ))}
            </ul>
            <div className="p-5"><VerifyForm id={item.id} /></div>
          </Card>
          <Card>
            <CardHeader title="History" />
            <ul className="divide-y divide-line px-5 pb-2 text-sm">
              {item.changes.map((c) => (
                <li key={c.id} className="py-2">
                  <span className="font-semibold">{c.action}</span> <span className="text-muted">v{c.version} · {c.actor} · {c.at.toISOString().slice(0, 16).replace('T', ' ')}</span>
                  {(c.diff as { fields?: string[]; note?: string } | null)?.fields && <div className="text-xs text-muted">Changed: {(c.diff as { fields: string[] }).fields.join(', ')}</div>}
                  {(c.diff as { note?: string } | null)?.note && <div className="text-xs text-muted">{(c.diff as { note: string }).note}</div>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
