'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useClub } from '@/lib/club';
import { Loading, SignInPrompt } from '@/components/ui';
import Overview from '@/components/admin/Overview';
import Sessions from '@/components/admin/Sessions';
import Payments from '@/components/admin/Payments';
import Refunds from '@/components/admin/Refunds';
import Courts from '@/components/admin/Courts';
import Members from '@/components/admin/Members';
import Settings from '@/components/admin/Settings';
import Activity from '@/components/admin/Activity';

const TABS = [
  ['overview', 'Overview', false], ['sessions', 'Open play', false], ['payments', 'Payments', false],
  ['refunds', 'Refunds', true], ['courts', 'Courts', true], ['members', 'Members', false],
  ['settings', 'Settings', true], ['activity', 'Activity', true],
] as const;
type Tab = (typeof TABS)[number][0];

export default function Admin() {
  const { slug } = useParams<{ slug: string }>();
  const c = useClub(slug);
  const [tab, setTab] = useState<Tab>('overview');
  const [counts, setCounts] = useState<{ review: number; refunds: number }>({ review: 0, refunds: 0 });

  const refreshCounts = useCallback(async () => {
    if (!c.club || !c.isStaff) return;
    const p = await rpc<unknown[]>('club_payments', { p_club: c.club.id, p_status: 'review', p_limit: 100 });
    const r = await rpc<unknown[]>('club_refunds', { p_club: c.club.id, p_status: 'owed' });
    setCounts({ review: p.length, refunds: r.length });
  }, [c.club, c.isStaff]);
  useEffect(() => { refreshCounts(); }, [refreshCounts, tab]);
  useEffect(() => { const h = location.hash.slice(1); if (TABS.some((t) => t[0] === h)) setTab(h as Tab); }, []);

  if (!c.ready || c.club === undefined) return <main className="page wide"><Loading /></main>;
  if (!c.signedIn) return <main className="page"><SignInPrompt what="manage your club" /></main>;
  if (!c.club || !c.isStaff) return <main className="page"><h1>Not available</h1><p>You don’t manage this club.</p><Link href="/">Clubs</Link></main>;
  const club = c.club;
  const props = { club, isAdmin: c.isAdmin, onChange: () => { refreshCounts(); c.reload(); } };

  return (
    <main className="page wide">
      <div className="row between">
        <h1 style={{ marginBottom: 4 }}>{club.name}</h1>
        <Link href={`/c/${club.slug}`} className="small">View club page</Link>
      </div>
      {!club.is_published && <p className="tag hold">Not visible to players yet. Publish it in Settings.</p>}
      <div className="tabs" role="tablist">
        {TABS.filter(([, , adminOnly]) => c.isAdmin || !adminOnly).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); history.replaceState(null, '', `#${k}`); }}>
            {label}
            {k === 'payments' && counts.review > 0 && <span className="count">{counts.review}</span>}
            {k === 'refunds' && counts.refunds > 0 && <span className="count">{counts.refunds}</span>}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview {...props} go={(t: Tab) => setTab(t)} />}
      {tab === 'sessions' && <Sessions {...props} />}
      {tab === 'payments' && <Payments {...props} />}
      {tab === 'refunds' && <Refunds {...props} />}
      {tab === 'courts' && <Courts {...props} />}
      {tab === 'members' && <Members {...props} />}
      {tab === 'settings' && <Settings {...props} />}
      {tab === 'activity' && <Activity {...props} />}
    </main>
  );
}
