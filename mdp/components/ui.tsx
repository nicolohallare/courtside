'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/supabase';

export function TopBar() {
  const path = usePathname() || '/';
  const { session } = useSession();
  const cur = (p: string) => (p === '/' ? path === '/' : path.startsWith(p)) ? 'page' : undefined;
  return (
    <header className="top">
      <div className="demo-banner">Preview of the new Match Day Pickle app</div>
      <div className="top-in">
        <Link href="/" className="brand">Match Day Pickle<small>OPEN PLAY · TOURNAMENTS</small></Link>
        <nav aria-label="Main">
          <Link href="/" aria-current={cur('/')}>Open play</Link>
          {session ? <Link href="/me/" aria-current={cur('/me')}>Me</Link>
                   : <Link href="/login/" aria-current={cur('/login')}>Sign in</Link>}
        </nav>
      </div>
    </header>
  );
}

/* ── toast ── */
const ToastCtx = createContext<(m: string, bad?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ m: string; bad: boolean } | null>(null);
  const show = useCallback((m: string, bad = false) => {
    setT({ m, bad }); setTimeout(() => setT(null), bad ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={'toast' + (t.bad ? ' bad' : '')} role="status">{t.m}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Loading() { return <p className="muted">Loading…</p>; }

export function SignInPrompt({ what }: { what: string }) {
  return (
    <div className="panel">
      <p>Sign in to {what}.</p>
      <Link className="btn primary" href="/login/">Sign in</Link>
    </div>
  );
}
