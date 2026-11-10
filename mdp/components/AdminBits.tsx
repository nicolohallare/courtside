'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMe } from '@/lib/me';
import { Band, Empty, Loading } from './Shell';
import type { Player } from '@/lib/admin';

const TABS = [
  { href: '/admin/', label: 'Today', match: (p: string) => p === '/admin' || p === '/admin/' },
  { href: '/admin/payments/', label: 'Payments', match: (p: string) => p.startsWith('/admin/payments') },
  { href: '/admin/sessions/', label: 'Sessions', match: (p: string) => p.startsWith('/admin/session') || p.startsWith('/admin/edit') },
];

/** The navy band at the top of every admin screen, with Today / Payments / Sessions. */
export function AdminBand({ title, sub, back, children, badges = {} }: { title: string; sub?: ReactNode; back?: { href: string; label: string }; children?: ReactNode; badges?: Record<string, number> }) {
  const path = usePathname() || '';
  return (
    <Band back={back}>
      {!back && (
        <div className="seg" style={{ marginTop: 6, marginBottom: 16 }}>
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={'segl' + (t.match(path) ? ' on' : '')}>
              {t.label}{badges[t.label] ? <span className="cnt">{badges[t.label]}</span> : null}
            </Link>
          ))}
        </div>
      )}
      <h1 className="h1" style={{ marginTop: back ? 8 : 0 }}>{title}</h1>
      {sub && <p className="sub" style={{ marginTop: 4 }}>{sub}</p>}
      {children}
    </Band>
  );
}

/** Renders children only for MDP admins. */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { ready, userId, profile } = useMe();
  if (!ready || (userId && !profile)) return <Loading />;
  if (!userId) return <Empty title="Sign in to use Admin"><Link className="link" href="/login/?next=/admin/">Sign in</Link></Empty>;
  if (!profile?.is_admin && !profile?.super_admin) return <Empty title="For MDP admins">This part of the app is for the people who run sessions.</Empty>;
  return <>{children}</>;
}

/** One word for where a booking stands, with the colour that goes with it. */
export function RegTag({ p }: { p: Player }) {
  const m: Record<string, [string, string]> = {
    paid: ['Paid', 'ok'], pending: [p.ai_check_status === 'flagged' ? 'Check receipt' : 'Checking', 'wait'], invited: ['Approved, not paid', 'wait'],
    waitlisted: [`Waitlist${p.waitlist_position ? ' #' + p.waitlist_position : ''}`, 'off'], rejected: ['Rejected', 'off'], cancelled: ['Cancelled', 'off'],
  };
  const [t, c] = m[p.status] ?? [p.status, 'off'];
  return <span className={'tag ' + c}>{t}</span>;
}
