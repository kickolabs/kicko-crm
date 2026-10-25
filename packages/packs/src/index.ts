import { immigrationPack } from './immigration';
import type { PackManifest } from './types';

export * from './types';

// Installed industry packs. A workspace turns packs on (TenantPack); the core reads
// labels, fields, library types and workflow templates from here, never from constants.
export const PACKS: Record<string, PackManifest> = {
  [immigrationPack.id]: immigrationPack,
};

/** The pack every workspace starts with until sign-up offers a choice of industry. */
export const DEFAULT_PACK = immigrationPack.id;

export function getPack(id: string): PackManifest {
  const p = PACKS[id];
  if (!p) throw new Error(`Unknown industry pack: ${id}`);
  return p;
}

/** An industry word for a core concept, e.g. label(pack, 'organization') → "Employer". */
export const label = (pack: PackManifest | undefined, key: string, fallback: string) => pack?.labels[key] ?? fallback;
