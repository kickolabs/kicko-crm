import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { Suspense } from 'react';
import { NavProgress } from '@/components/nav-progress';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'Kicko · CRM for visa & immigration consultancies', template: '%s · Kicko' },
  description: 'Leads, WhatsApp, cases, documents, GST billing, calls and an AI assistant in one place, built for visa and immigration agencies in India.',
  openGraph: { type: 'website', siteName: 'Kicko' },
};

export const viewport: Viewport = { themeColor: '#F4F3EE' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="min-h-dvh font-sans text-[14px]">
        {/* Reads the URL; its own Suspense so pages never wait on it. */}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
