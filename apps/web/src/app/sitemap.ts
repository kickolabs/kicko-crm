import type { MetadataRoute } from 'next';

const base = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/** Public website pages only; workspaces, portals and the admin console are private. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number][] = [['', 1], ['/pricing', 0.9], ['/security', 0.6], ['/signup', 0.6], ['/terms', 0.3], ['/privacy', 0.3], ['/dpa', 0.3]];
  return pages.map(([path, priority]) => ({ url: `${base()}${path}`, changeFrequency: 'monthly', priority }));
}
