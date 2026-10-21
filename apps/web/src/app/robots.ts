import type { MetadataRoute } from 'next';

// Only the public website is crawlable. Workspace pages also 404 for visitors
// who aren't members, but keeping crawlers out avoids wasted requests.
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return {
    rules: [{ userAgent: '*', allow: ['/$', '/pricing', '/security', '/terms', '/privacy', '/dpa', '/signup'], disallow: '/' }],
    sitemap: `${base}/sitemap.xml`,
  };
}
