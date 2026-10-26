import 'server-only';
import { prisma, type LibraryItem } from '@kicko/db';
import { getPack, type PackManifest } from '@kicko/packs';
import { cache } from 'react';
import type { Allowed } from '@/lib/pack-fields';
import { aliasesOf } from '@/lib/countries';
import { inTenant, type Scope } from './scope';

// The industry pack's reference library, as workspaces see it. The library is global and
// changes rarely, so lists are cached in memory for a few minutes (the library admin
// clears the cache on edits).

export type LibraryOption = { key: string; name: string; parentKey: string | null; group?: string; search?: string; coverage: string | null; unverified: boolean };

const TTL = 5 * 60_000;
const lists = new Map<string, { at: number; rows: LibraryOption[] }>();

export function clearLibraryCache() {
  lists.clear();
}

/** Extra words a picker matches: a country's everyday names, an occupation's aliases. */
const searchOf = (type: string, key: string, data: Record<string, unknown>) =>
  type === 'country' ? [key, ...aliasesOf(key)].join(' | ') : Array.isArray(data.aliases) ? (data.aliases as string[]).join(' | ') : undefined;

const groupOf = (type: string, data: Record<string, unknown>) =>
  type === 'country' ? (data.region as string | undefined) : type === 'occupation' ? (data.group as string | undefined) : undefined;

/** Lean list of published items of a type (for selects), sorted by name. */
export async function libraryList(packId: string, type: string): Promise<LibraryOption[]> {
  const id = `${packId}:${type}`;
  const hit = lists.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.rows;
  const rows = await prisma.libraryItem.findMany({
    where: { packId, type, status: 'published' },
    select: { key: true, name: true, parentKey: true, coverage: true, unverified: true, data: true },
    orderBy: { name: 'asc' },
  });
  const lean = rows.map((r) => ({ key: r.key, name: r.name, parentKey: r.parentKey, group: groupOf(type, r.data as Record<string, unknown>), search: searchOf(type, r.key, r.data as Record<string, unknown>), coverage: r.coverage, unverified: r.unverified }));
  lists.set(id, { at: Date.now(), rows: lean });
  return lean;
}

export async function libraryItem(packId: string, type: string, key: string): Promise<LibraryItem | null> {
  return prisma.libraryItem.findUnique({ where: { packId_type_key: { packId, type, key } } });
}

/** The workspace's industry pack (first enabled), with its settings. Cached per request. */
export const tenantPack = cache(async (scope: Pick<Scope, 'tenantId' | 'readOnly'>): Promise<{ pack: PackManifest; settings: { hiddenFields?: string[] } }> => {
  const row = await inTenant(scope as Scope, (tx) => tx.tenantPack.findFirst({ where: { enabled: true }, orderBy: { createdAt: 'asc' } }));
  return { pack: getPack(row?.packId ?? 'immigration'), settings: (row?.settings as { hiddenFields?: string[] }) ?? {} };
});

/** Library keys that exist, for validating lookup fields (library + the agency's own items). */
export async function allowedKeys(scope: Scope, pack: PackManifest): Promise<Allowed> {
  const types = [...new Set(pack.fields.filter((f) => f.library).map((f) => f.library!))];
  const own = await inTenant(scope, (tx) => tx.tenantLibraryItem.findMany({ where: { packId: pack.id, hidden: false }, select: { type: true, key: true } }));
  const out: Allowed = {};
  for (const t of types) {
    out[t] = new Set([...(await libraryList(pack.id, t)).map((o) => o.key), ...own.filter((o) => o.type === t).map((o) => o.key)]);
  }
  return out;
}

/** Options for the pack's lookup fields: the library plus the agency's own entries, minus hidden ones. */
export async function lookupOptions(scope: Scope, pack: PackManifest): Promise<Record<string, LibraryOption[]>> {
  const types = [...new Set([...(pack.regionType ? [pack.regionType] : []), ...pack.fields.filter((f) => f.library).map((f) => f.library!)])];
  const own = await inTenant(scope, (tx) => tx.tenantLibraryItem.findMany({ where: { packId: pack.id } }));
  const out: Record<string, LibraryOption[]> = {};
  for (const t of types) {
    const hidden = new Set(own.filter((o) => o.type === t && o.hidden).map((o) => o.key));
    const mine = own.filter((o) => o.type === t && !o.hidden).map((o) => ({ key: o.key, name: o.name, parentKey: o.parentKey, group: groupOf(t, o.data as Record<string, unknown>), coverage: null, unverified: false }));
    const lib = (await libraryList(pack.id, t)).filter((o) => !hidden.has(o.key));
    const seen = new Set(mine.map((m) => m.key));
    out[t] = [...mine, ...lib.filter((o) => !seen.has(o.key))].sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

/** Fields the pack adds to an entity, minus those the agency hid. */
export function visibleFields(pack: PackManifest, settings: { hiddenFields?: string[] }, entity: 'leads' | 'clients' | 'cases') {
  const hidden = new Set(settings.hiddenFields ?? []);
  return pack.fields.filter((f) => f.entity === entity && !hidden.has(`${entity}.${f.key}`));
}

export type PackFormProps = Awaited<ReturnType<typeof packForm>>;

/** What a form needs to render the pack's fields for `entity`, plus the pack's words and lists. */
export async function packForm(scope: Scope, entity: 'leads' | 'clients' | 'cases') {
  const { pack, settings } = await tenantPack(scope);
  const lookups = await lookupOptions(scope, pack);
  const pathways = await libraryList(pack.id, pack.workflowType);
  const pathwayCount: Record<string, number> = {};
  for (const p of pathways) if (p.parentKey) pathwayCount[p.parentKey] = (pathwayCount[p.parentKey] ?? 0) + 1;
  return {
    fields: visibleFields(pack, settings, entity),
    lookups: Object.fromEntries(Object.entries(lookups).map(([t, list]) => [t, list.map(({ key, name, group, search }) => ({ key, name, group, search }))])),
    groupLabels: pack.groupLabels ?? {},
    categories: pack.categories,
    labels: pack.labels,
    regionType: pack.regionType ?? null,
    pathwayCount,
  };
}

/** Resolve library keys to names from a form's lookup lists (falls back to the key). */
export function lookupName(lookups: Record<string, { key: string; name: string }[]>) {
  const maps = Object.fromEntries(Object.entries(lookups).map(([t, list]) => [t, new Map(list.map((o) => [o.key, o.name]))]));
  return (type: string, key: string) => maps[type]?.get(key) ?? key;
}

/** Countries to offer in a picker: the agency's destinations first, then every other country. */
export async function countryChoices(scope: Scope): Promise<{ offered: [string, string][]; others: [string, string][] }> {
  const { pack } = await tenantPack(scope);
  const all = (await lookupOptions(scope, pack))[pack.regionType ?? 'country'] ?? [];
  const mine = new Set((await inTenant(scope, (tx) => tx.visaProduct.findMany({ where: { active: true }, select: { country: true } }))).map((p) => p.country));
  return {
    offered: all.filter((c) => mine.has(c.key)).map((c) => [c.key, c.name]),
    others: all.filter((c) => !mine.has(c.key)).map((c) => [c.key, c.name]),
  };
}
