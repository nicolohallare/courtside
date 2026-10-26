import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TopBar, ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Match Day Pickle',
  description: 'Open play, tournaments and DUPR in one app.',
};
export const viewport: Viewport = { themeColor: '#0d1b2a', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
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
