'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useClub } from '@/lib/club';
import { ROLE_LABEL, type SessionRow, fmtDay, fmtTime, peso } from '@/lib/format';
import { Loading, SeatStrip } from '@/components/ui';
import { BookingGate } from '@/components/gate';

export default function ClubPage() {
  const { slug } = useParams<{ slug: string }>();
  const c = useClub(slug);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);

  useEffect(() => {
    if (c.club) rpc<SessionRow[]>('list_sessions', { p_club: c.club.id, p_days: 21 }).then(setSessions);
  }, [c.club]);

  if (c.club === undefined) return <main className="page"><Loading /></main>;
  if (c.club === null) return <main className="page"><h1>Club not found</h1><Link href="/">See all clubs</Link></main>;
  const club = c.club;
  const live = (sessions ?? []).filter((s) => s.status === 'scheduled' && Date.parse(s.starts_at) > Date.now());

  return (
    <main className="page">
      <div className="clubhead">
        <h1>{club.name}</h1>
        <p>{[club.venue_name, club.address || club.city].filter(Boolean).join(' · ')}</p>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <Link className="btn court grow" href={`/c/${club.slug}/courts`}>Rent a court</Link>
        {c.isStaff && <Link className="btn" href={`/admin/${club.slug}`}>Manage club</Link>}
      </div>
      {c.membership && !['member'].includes(c.membership.role) && (
        <p className="small muted">You’re {ROLE_LABEL[c.membership.role].toLowerCase()} here.</p>
      )}

      <BookingGate c={c} />

      <h2>Open play</h2>
      {!sessions ? <Loading /> : live.length === 0 ? (
        <div className="panel"><p className="muted">No open play scheduled in the next three weeks.</p></div>
      ) : (
        <div className="panel">
          {live.map((s) => (
            <Link key={s.id} href={`/c/${club.slug}/s/${s.id}`} className="session">
              <div className="when"><div className="d">{fmtDay(s.starts_at)}</div><div className="t">{fmtTime(s.starts_at)}</div></div>
              <div>
                <div className="row between"><h3>{s.title}</h3><span className="num">{peso(s.fee)}</span></div>
                <div className="small muted">{[s.level, s.court_names.join(', ')].filter(Boolean).join(' · ')}</div>
                <SeatStrip capacity={s.capacity} taken={s.seats_taken} waitlist={s.waitlist_seats} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {club.tagline && <p className="muted">{club.tagline}</p>}
      <p className="small muted">Cancel at least {club.refund_cutoff_hours} hours before a game for a full refund.</p>
    </main>
  );
}
