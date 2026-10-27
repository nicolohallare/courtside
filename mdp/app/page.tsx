'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMe } from '@/lib/me';
import { dayHeading, fmtClock, manilaToday, peso } from '@/lib/format';
import { activeReg, isDuprNight, loadHosts, loadMyRegs, loadSessions, type Reg, type Sess } from '@/lib/sessions';
import { Band, Empty, Loading } from '@/components/Shell';
import { SessionTags, Spots } from '@/components/SessionBits';
import { Ticket } from '@/components/Ticket';

const FILTERS = [
  { k: 'all', label: 'All sessions', test: () => true },
  { k: 'dupr', label: 'DUPR nights', test: (s: Sess) => isDuprNight(s) },
  { k: 'open', label: 'Open play', test: (s: Sess) => !isDuprNight(s) && !s.organizer_id },
  { k: 'host', label: 'Hosted', test: (s: Sess) => !!s.organizer_id },
  { k: 'free', label: 'Spots left', test: (s: Sess) => s.seats_used < s.max_players },
] as const;

export default function Play() {
  const { userId, profile } = useMe();
  const [sessions, setSessions] = useState<Sess[] | null>(null);
  const [error, setError] = useState('');
  const [hosts, setHosts] = useState<Record<string, string>>({});
  const [regs, setRegs] = useState<Reg[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['k']>('all');

  useEffect(() => {
    loadSessions().then(setSessions).catch((e) => setError(e.message));
    loadHosts().then(setHosts);
  }, []);
  useEffect(() => { if (userId) loadMyRegs().then(setRegs).catch(() => {}); else setRegs([]); }, [userId]);

  const next = useMemo(() => {
    const today = manilaToday();
    return regs.filter((r) => r.sessions && !r.paid_by_reg_id && !r.sessions.is_cancelled && r.sessions.session_date >= today && !['cancelled', 'rejected'].includes(r.status))
      .sort((a, b) => (a.sessions!.session_date + a.sessions!.time_start).localeCompare(b.sessions!.session_date + b.sessions!.time_start))[0] ?? null;
  }, [regs]);

  const days = useMemo(() => {
    const f = FILTERS.find((x) => x.k === filter)!;
    const m = new Map<string, Sess[]>();
    for (const s of (sessions ?? []).filter(f.test)) m.set(s.session_date, [...(m.get(s.session_date) ?? []), s]);
    return [...m.entries()];
  }, [sessions, filter]);

  const first = (profile?.full_name ?? '').split(' ')[0];
  return (
    <>
      <Band>
        <h1 className="h1" style={{ marginTop: 10 }}>{first ? `Hi ${first}, find your next game` : 'Find your next game'}</h1>
        <p className="sub" style={{ marginTop: 6 }}>Book a spot, pay in the app, and get put on court when you arrive.</p>
        {next && (
          <div style={{ marginTop: 18 }}>
            <div className="small" style={{ fontWeight: 700, marginBottom: 8, color: 'var(--cream)' }}>Your next game</div>
            <Ticket r={next} href={'/s/?id=' + next.session_uuid} />
          </div>
        )}
      </Band>

      <div className="chips" role="tablist" aria-label="Filter sessions">
        {FILTERS.map((f) => <button key={f.k} role="tab" aria-selected={filter === f.k} className={'chip' + (filter === f.k ? ' on' : '')} onClick={() => setFilter(f.k)}>{f.label}</button>)}
      </div>

      {error && <Empty title="Sessions didn't load">{error}</Empty>}
      {!sessions && !error && <Loading rows={4} />}
      {sessions && days.length === 0 && <Empty title="Nothing here yet">{filter === 'all' ? 'New sessions are posted every week.' : 'Try another filter.'}</Empty>}
      {days.map(([d, list]) => {
        const h = dayHeading(d);
        return (
          <section key={d} aria-label={h.title}>
            <div className="day-head"><span className="h3">{h.title}</span><span className="sub">{h.sub}</span></div>
            {list.map((s) => {
              const mine = activeReg(regs, s.id);
              return (
                <Link key={s.id} href={'/s/?id=' + s.id} className={'srow' + (mine ? ' mine' : '')}>
                  <div>
                    <div className="ttl">{s.label}</div>
                    <div className="meta">{fmtClock(s.time_start)} to {fmtClock(s.time_end)}</div>
                    <div className="meta">{s.venue}</div>
                  </div>
                  <div className="price"><div className="num">{peso(s.fee)}</div>{mine && <span className={'tag ' + (mine.status === 'paid' ? 'ok' : 'wait')}>{mine.status === 'paid' ? 'Booked' : mine.status === 'invited' ? 'Pay to confirm' : mine.status === 'waitlisted' ? 'Waitlist' : 'Checking'}</span>}</div>
                  <SessionTags s={s} host={s.organizer_id ? hosts[s.organizer_id] : undefined} />
                  <div className="spots"><Spots s={s} /></div>
                </Link>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
