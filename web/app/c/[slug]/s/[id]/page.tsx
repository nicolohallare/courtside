'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { rpc, sb, useSession } from '@/lib/supabase';
import { useClub } from '@/lib/club';
import { BOOKING_STATUS, type SessionRow, fmtDay, fmtRange, peso } from '@/lib/format';
import { Loading, SeatStrip, TrustLine, useToast } from '@/components/ui';
import { BookingGate } from '@/components/gate';

export default function SessionPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const c = useClub(slug);
  const { userId } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState<SessionRow | null | undefined>(undefined);
  const [players, setPlayers] = useState<{ first_name: string; guests: number; waitlisted: boolean }[]>([]);
  const [mine, setMine] = useState<{ id: string; status: string } | null>(null);
  const [maxGuests, setMaxGuests] = useState(0);
  const [guests, setGuests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!c.club) return;
    const list = await rpc<SessionRow[]>('list_sessions', { p_club: c.club.id, p_from: new Date(Date.now() - 864e5 * 2).toISOString(), p_days: 120 });
    setS(list.find((x) => x.id === id) ?? null);
    setPlayers(await rpc('session_players', { p_session: id }));
    if (userId) {
      const { data } = await sb().from('session_bookings').select('id, status').eq('session_id', id).eq('user_id', userId)
        .in('status', ['pending_payment', 'confirmed', 'waitlist_pending_payment', 'waitlisted']).maybeSingle();
      setMine(data);
    }
  }, [c.club, id, userId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!c.club || !c.membership) return;
    sb().from('club_role_rules').select('max_guests').eq('club_id', c.club.id).eq('role', c.membership.role).maybeSingle()
      .then(({ data }) => setMaxGuests(data?.max_guests ?? 0));
  }, [c.club, c.membership]);

  if (c.club === undefined || s === undefined) return <main className="page"><Loading /></main>;
  if (!c.club || !s) return <main className="page"><h1>Session not found</h1><Link href={`/c/${slug}`}>Back to club</Link></main>;

  const open = s.capacity - s.seats_taken;
  const seats = 1 + guests.filter((g) => g.trim()).length;
  const full = open < seats;
  const started = Date.parse(s.starts_at) <= Date.now();

  async function book() {
    setBusy(true);
    try {
      const r = await rpc<{ booking_id: string; status: string }>('book_session', { p_session: id, p_guest_names: guests.filter((g) => g.trim()) });
      if (r.status === 'confirmed' || r.status === 'waitlisted') { toast(BOOKING_STATUS[r.status]); load(); }
      else router.push(`/checkout?kind=session&id=${r.booking_id}`);
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  return (
    <main className="page">
      <p className="small"><Link href={`/c/${slug}`}>{c.club.name}</Link></p>
      <h1>{s.title}</h1>
      <p className="num" style={{ fontSize: '1.4rem', margin: 0 }}>{fmtDay(s.starts_at)}, {fmtRange(s.starts_at, s.ends_at)}</p>
      <p className="muted">{[s.level, s.court_names.join(', ')].filter(Boolean).join(' · ')}</p>
      {s.status === 'cancelled' && <p className="tag bad">Cancelled by the club</p>}

      <div className="panel">
        <div className="row between"><span className="amount">{peso(s.fee)}</span><span className="muted">per player</span></div>
        <SeatStrip capacity={s.capacity} taken={s.seats_taken} waitlist={s.waitlist_seats} />
        {s.description && <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{s.description}</p>}
      </div>

      {mine ? (
        <div className="panel">
          <p><span className={'tag ' + (mine.status === 'confirmed' ? 'ok' : 'hold')}>{BOOKING_STATUS[mine.status]}</span></p>
          {['pending_payment', 'waitlist_pending_payment'].includes(mine.status)
            ? <Link className="btn primary block" href={`/checkout?kind=session&id=${mine.id}`}>Pay to keep your spot</Link>
            : <Link href="/me">See it in My bookings</Link>}
        </div>
      ) : s.status === 'scheduled' && !started ? (
        <>
          <BookingGate c={c} />
          {c.canBook && (
            <div className="panel stack">
              {maxGuests > 0 && (
                <div>
                  {guests.map((g, i) => (
                    <label key={i} className="field"><span>Guest {i + 1} name</span>
                      <div className="row">
                        <input type="text" className="grow" value={g} onChange={(e) => setGuests(guests.map((x, j) => (j === i ? e.target.value : x)))} style={{ width: 'auto' }} />
                        <button className="linkbtn" onClick={() => setGuests(guests.filter((_, j) => j !== i))}>Remove</button>
                      </div>
                    </label>
                  ))}
                  {guests.length < maxGuests && <button className="linkbtn" onClick={() => setGuests([...guests, ''])}>Bring a guest</button>}
                </div>
              )}
              <button className="btn primary block" disabled={busy || (full && !s.waitlist_enabled)} onClick={book}>
                {full ? (s.waitlist_enabled ? `Join the waitlist · ${peso(s.fee * seats)}` : 'Full') : `Book ${seats > 1 ? `${seats} spots` : 'my spot'} · ${peso(s.fee * seats)}`}
              </button>
              {full && s.waitlist_enabled && (
                <p className="small muted">You pay now to hold a waitlist place. If a spot opens you’re moved in automatically. If not, the club refunds you in full.</p>
              )}
              <TrustLine club={c.club.name} />
            </div>
          )}
        </>
      ) : null}

      {players.length > 0 && (
        <>
          <h2>Who’s playing</h2>
          <div className="panel small">
            {players.map((p, i) => (
              <span key={i} className={'tag ' + (p.waitlisted ? 'hold' : '')} style={{ margin: '0 6px 6px 0' }}>
                {p.first_name}{p.guests ? ` +${p.guests}` : ''}{p.waitlisted ? ' (waitlist)' : ''}
              </span>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
