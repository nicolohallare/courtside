import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/dm-sans/index.css';
import './globals.css';
import { Header, TabBar, ToastProvider } from '@/components/Shell';

export const metadata: Metadata = { title: 'Match Day Pickle', description: 'Open play, court board, tournaments and DUPR in one app.' };
export const viewport: Viewport = { themeColor: '#0d1b2a', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/mdp-logo.webp" />
      </head>
      <body>
        <ToastProvider>
          <div className="app">
            <Header />
            <main>{children}</main>
            <TabBar />
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
