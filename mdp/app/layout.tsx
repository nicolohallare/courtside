import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Header, TabBar, ToastProvider } from '@/components/Shell';

export const metadata: Metadata = { title: 'Match Day Pickle', description: 'Open play, tournaments and DUPR in one app.' };
export const viewport: Viewport = { themeColor: '#f5ede0', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ToastProvider>
          <div className="app">
            <Header />
            <div className="scroll">{children}</div>
            <TabBar />
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
