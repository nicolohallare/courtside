import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TopBar, ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Courtside',
  description: 'Book open play and courts at your club. Pay the club directly.',
  manifest: '/manifest.webmanifest',
};
export const viewport: Viewport = { themeColor: '#0e4d6b', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ToastProvider>
          <TopBar />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
