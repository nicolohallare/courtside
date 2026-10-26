'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useMe } from '@/lib/me';

export function Header() {
  const { profile, userId, ready } = useMe();
  const first = (profile?.full_name ?? '').split(' ')[0];
  return (
    <>
      <div className="preview-strip">Preview of the new Match Day Pickle app</div>
      <div className="hdr">
        <div className="hdr-inner">
          <Link href="/" className="brand">
            <img className="brand-logo" src="/mdp-logo.webp" alt="MDP" />
            <div><div className="brand-name">Match Day Pickle!</div><span className="brand-sub">Open Play</span></div>
          </Link>
          <div className="hdr-right">
            {!ready ? null : userId
              ? <Link className="pill user-pill" href="/me/">👤 {first || 'Me'}</Link>
              : <Link className="pill register-pill" href="/login/">Sign In</Link>}
          </div>
        </div>
      </div>
    </>
  );
}

export function TabBar() {
  const path = usePathname() || '/';
  const on = (p: string) => (p === '/' ? path === '/' || path.startsWith('/book') : path.startsWith(p)) ? ' active' : '';
  return (
    <div className="tabbar">
      <Link className={'tbtn' + on('/')} href="/"><span className="ticon">🏠</span>Home</Link>
      <Link className={'tbtn' + on('/slots')} href="/slots/"><span className="ticon">📋</span>My Slots</Link>
      <Link className={'tbtn' + on('/me')} href="/me/"><span className="ticon">👤</span>Me</Link>
    </div>
  );
}

const ToastCtx = createContext<(m: string, bad?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ m: string; bad: boolean } | null>(null);
  const show = useCallback((m: string, bad = false) => { setT({ m, bad }); setTimeout(() => setT(null), bad ? 6000 : 3500); }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={'toast2' + (t.bad ? ' bad' : '')} role="status">{t.m}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="ov" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="sheet-ttl">{title}</div>
        {children}
        <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) { return <div className="empty2">{text}</div>; }
