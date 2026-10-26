'use client';
import { useEffect, useState } from 'react';
import { mdpApi, rpc } from '@/lib/supabase';
import { fmtClock, fmtDate, peso } from '@/lib/format';
import { Loading } from '@/components/ui';

interface Sess {
  id: string; label: string; session_date: string; time_start: string; time_end: string; venue: string;
  fee: number; max_players: number; seats_used: number; waitlist_count: number; organizer_id: string | null; courts: number | null;
}

// Booking still happens in the current app until it moves here; each card links to it.
const bookUrl = (id: string) => `https://matchdaypickleop.netlify.app/?s=${id}`;

export default function Home() {
  const [list, setList] = useState<Sess[] | null>(null);
  const [hosts, setHosts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    mdpApi<Sess[]>('sessions', 'upcoming=true&limit=15').then(setList).catch((e) => setError(e.message));
    rpc<Record<string, string>>('organizer_names').then((h) => setHosts(h ?? {})).catch(() => {});
  }, []);
  return (
    <main className="page">
      <div className="kicker">Open play</div>
      <h1>Reserve your spot on court</h1>
      {error && <p className="err">{error}</p>}
      {!list && !error ? <Loading /> : list && list.length === 0 ? (
        <div className="panel"><p>No upcoming sessions yet.</p></div>
      ) : (
        <div className="panel">
          {(list ?? []).map((s) => {
            const left = Math.max(0, s.max_players - s.seats_used);
            return (
              <a key={s.id} href={bookUrl(s.id)} className="session">
                <div className="when">
                  <div className="d">{fmtDate(s.session_date)}</div>
                  <div className="t">{fmtClock(s.time_start)}</div>
                </div>
                <div>
                  <h3>{s.label}</h3>
                  <div className="muted small">{s.venue} · {fmtClock(s.time_start)}–{fmtClock(s.time_end)} · {peso(s.fee)}</div>
                  {s.organizer_id && <div className="small" style={{ color: 'var(--hold)', fontWeight: 700 }}>Hosted by {hosts[s.organizer_id] ?? 'a partner host'}</div>}
                  <div className="seatline">{left > 0 ? `${left} of ${s.max_players} spots open` : 'Full'}{s.waitlist_count ? ` · ${s.waitlist_count} waiting` : ''}</div>
                </div>
              </a>
            );
          })}
        </div>
      )}
      <p className="muted small">Booking opens in the current MDP app while it moves here.</p>
    </main>
  );
}
