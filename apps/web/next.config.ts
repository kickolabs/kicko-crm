import type { NextConfig } from 'next';

// Env comes from the repo-root .env via dotenv-cli in package.json scripts.
const nextConfig: NextConfig = {
  // E2E runs a production build in its own folder so it never clashes with `next dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@kicko/db'],
  serverExternalPackages: ['@prisma/client', '.prisma/client', 'pdf-lib', '@pdf-lib/fontkit'],
  // PDF fonts are read from disk at runtime; make sure they ship with the server bundle.
  outputFileTracingIncludes: {
    '/api/t/[tenant]/billing/**': ['../../node_modules/@fontsource/plus-jakarta-sans/files/*.woff'],
    '/portal/[slug]/files/**': ['../../node_modules/@fontsource/plus-jakarta-sans/files/*.woff'],
  },
  typedRoutes: false,
  async headers() {
    return [
      {
        // Public enquiry form and kiosk may be embedded in agency websites.
        source: '/f/:path*',
        headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
      },
      {
        // Uploaded documents are previewed in an <iframe> inside the app.
        source: '/api/files/:path*',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
      {
        source: '/((?!f/|api/files/).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;
