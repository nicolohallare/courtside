'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/supabase';
import { peso } from '@/lib/format';

export function TopBar() {
  const path = usePathname();
  const { session } = useSession();
  const cur = (p: string) => (path === p || (p !== '/' && path.startsWith(p)) ? 'page' : undefined);
  return (
    <header className="top">
      <div className="top-in">
        <Link href="/" className="brand"><span className="brand-mark" aria-hidden />Courtside</Link>
        <nav aria-label="Main">
          <Link href="/" aria-current={path === '/' ? 'page' : undefined}>Clubs</Link>
          {session ? <Link href="/me" aria-current={cur('/me')}>My bookings</Link>
                   : <Link href="/login" aria-current={cur('/login')}>Sign in</Link>}
        </nav>
      </div>
    </header>
  );
}

/** Filled squares for taken seats, outlines for open ones, dashed for the waitlist. */
export function SeatStrip({ capacity, taken, waitlist = 0 }: { capacity: number; taken: number; waitlist?: number }) {
  const shown = Math.min(capacity, 40);
  const filled = Math.min(taken, capacity);
  const open = capacity - filled;
  return (
    <>
      <div className="seats" role="img" aria-label={`${filled} of ${capacity} spots taken${waitlist ? `, ${waitlist} waiting` : ''}`}>
        {Array.from({ length: shown }, (_, i) => <span key={i} className={'seat' + (i < filled ? ' taken' : '')} />)}
        {Array.from({ length: Math.min(waitlist, 8) }, (_, i) => <span key={'w' + i} className="seat wait" />)}
      </div>
      <div className="seatline">
        {open > 0 ? `${open} of ${capacity} spots open` : 'Full'}{waitlist ? ` · ${waitlist} on the waitlist` : ''}
      </div>
    </>
  );
}

export function TrustLine({ club }: { club: string }) {
  return (
    <div className="trust">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden><path fill="none" stroke="#2f8f5b" strokeWidth="2.4" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-4 10 3 3 5-6"/></svg>
      <div>
        <strong>Pays {club} directly</strong>
        <span className="small muted">Never send money to a person in a chat. Every peso here is checked and recorded, and you can see it under My bookings.</span>
      </div>
    </div>
  );
}

export function Money({ v }: { v: number | string }) { return <span className="num">{peso(v)}</span>; }

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
      <Link className="btn primary" href={`/login?next=${encodeURIComponent(typeof window !== 'undefined' ? location.pathname : '/')}`}>Sign in</Link>
    </div>
  );
}
