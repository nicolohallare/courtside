'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMe } from '@/lib/me';
import { IS_DEMO } from '@/lib/supabase';
import { peso } from '@/lib/format';
import { Icon } from './Icon';

export function Header() {
  const { profile, userId, ready, wallet } = useMe();
  const initials = (profile?.full_name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <>
      {IS_DEMO && <div className="demo-strip">Demo with sample players. Nothing here touches the live app.</div>}
      <header className="top">
        <Link href="/" className="row" aria-label="Match Day Pickle home">
          <img className="logo" src="/mdp-logo.webp" alt="" />
          <span className="word">Match Day<br /><b>Pickle!</b></span>
        </Link>
        <span className="grow" />
        {ready && (userId ? (
          <>
            {wallet !== null && <Link href="/bookings/#wallet" className="wallet-pill" aria-label="Wallet balance"><i />{peso(wallet)}</Link>}
            <Link href="/me/" className="avatar" aria-label="Your profile">{initials || <Icon name="user" />}</Link>
          </>
        ) : <Link href="/login/" className="signin">Sign in</Link>)}
      </header>
    </>
  );
}

const TABS = [
  { href: '/', label: 'Play', icon: 'paddle', match: (p: string) => p === '/' || p.startsWith('/s') || p.startsWith('/book/') },
  { href: '/events/', label: 'Events', icon: 'trophy', match: (p: string) => p.startsWith('/events') },
  { href: '/courts/', label: 'Courts', icon: 'court', match: (p: string) => p.startsWith('/courts') },
  { href: '/bookings/', label: 'Bookings', icon: 'ticket', match: (p: string) => p.startsWith('/bookings') || p.startsWith('/slots') },
  { href: '/me/', label: 'Me', icon: 'user', match: (p: string) => p.startsWith('/me') },
];

export function TabBar() {
  const path = usePathname() || '/';
  return (
    <nav className="nav" aria-label="Main">
      {TABS.map((t) => {
        const on = t.match(path);
        if (t.label === 'Courts') return (
          <Link key={t.href} href={t.href} className={'courts' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined}>
            <span className="disc"><Icon name={t.icon} /></span>{t.label}
          </Link>
        );
        return <Link key={t.href} href={t.href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}><Icon name={t.icon} />{t.label}</Link>;
      })}
    </nav>
  );
}

const ToastCtx = createContext<(m: string, bad?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ m: string; bad: boolean; k: number } | null>(null);
  const show = useCallback((m: string, bad = false) => setT({ m, bad, k: Date.now() }), []);
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), t.bad ? 6000 : 3500); return () => clearTimeout(id); }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div key={t.k} className={'toast' + (t.bad ? ' bad' : '')} role="status">{t.m}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="ov" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grab" />
        <div className="between"><div className="h2">{title}</div><button className="link" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return <div aria-busy="true" style={{ paddingTop: 16 }}>{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" />)}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><div className="h3">{title}</div>{children}</div>;
}

export function Band({ children, back }: { children: ReactNode; back?: { href?: string; onClick?: () => void; label: string } }) {
  return (
    <div className="band">
      {back && (back.href
        ? <Link className="back" href={back.href}><Icon name="back" />{back.label}</Link>
        : <button className="back" onClick={back.onClick}><Icon name="back" />{back.label}</button>)}
      {children}
    </div>
  );
}
