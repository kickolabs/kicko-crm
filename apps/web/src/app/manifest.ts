import type { MetadataRoute } from 'next';

// Installable on phones and desktops ("Add to home screen"): opens straight into the app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kicko CRM',
    short_name: 'Kicko',
    description: 'CRM for visa and immigration consultancies',
    start_url: '/login',
    display: 'standalone',
    background_color: '#F4F3EE',
    theme_color: '#121417',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
