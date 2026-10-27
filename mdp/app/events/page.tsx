'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { fmtClock, fmtDate, peso } from '@/lib/format';
import { isDuprNight, loadSessions, type Sess } from '@/lib/sessions';
import { Band, Loading } from '@/components/Shell';
import { Spots } from '@/components/SessionBits';
import { eventDates, type Tournament } from '@/lib/events';
import { DuprTag } from '@/components/Dupr';

export default function Events() {
  const { userId, ready } = useMe();
  const [t, setT] = useState<Tournament | null | undefined>(undefined);
  const [nights, setNights] = useState<Sess[] | null>(null);
  useEffect(() => { loadSessions().then((l) => setNights(l.filter(isDuprNight))).catch(() => setNights([])); }, []);
  useEffect(() => { if (ready) (userId ? rpc<Tournament | null>('tournament_view', { p_tournament: null }) : Promise.resolve(null)).then(setT).catch(() => setT(null)); }, [ready, userId]);

  return (
    <>
      <Band>
        <h1 className="h1" style={{ marginTop: 10 }}>Events</h1>
        <p className="sub" style={{ marginTop: 6 }}>Match Day Pickle tournaments and DUPR nights. Every game counts for your DUPR rating.</p>
      </Band>

      <div className="section">
        <div className="section-head"><span className="h3">Tournaments</span></div>
        {t === undefined ? <Loading rows={1} /> : t ? (
          <Link href={'/events/t/?id=' + t.id} className="event">
            <div className={'poster' + (t.poster_url ? '' : ' blank')} style={t.poster_url ? { backgroundImage: `linear-gradient(to top, rgba(13,27,42,.85), rgba(13,27,42,0) 60%), url(${t.poster_url})` } : undefined}>
              <span className="when">{eventDates(t)}</span>
            </div>
            <div className="body">
              <div className="h2">{t.name}</div>
              {t.tagline && <p className="sub">{t.tagline}</p>}
              <p className="sub">{[t.venue, t.city].filter(Boolean).join(', ')}</p>
              <div className="tags" style={{ marginTop: 10 }}>
                <DuprTag label="Rated" dark />
                {t.entries?.length ? <span className="tag ok">{t.entries.length === 1 ? `You're in ${t.entries[0].division}` : `You're in ${t.entries.length} divisions`}</span> : t.open ? <span className="tag host">Registration open</span> : null}
              </div>
            </div>
          </Link>
        ) : <div className="card sub">{userId ? 'The next tournament hasn\'t been announced yet. You\'ll get a notification when registration opens.' : <><Link className="link" href="/login/?next=/events/">Sign in</Link> to see upcoming tournaments.</>}</div>}
      </div>

      <div className="section">
        <div className="section-head"><span className="h3">DUPR nights</span><span className="sub">Rated open play</span></div>
        {!nights ? <Loading rows={2} /> : nights.length === 0 ? <div className="card sub">No DUPR nights posted yet.</div> : nights.map((s) => (
          <Link key={s.id} href={'/s/?id=' + s.id} className="srow" style={{ margin: '0 0 8px' }}>
            <div><div className="ttl">{s.label}</div><div className="meta">{fmtDate(s.session_date)}, {fmtClock(s.time_start)}</div><div className="meta">{s.venue}</div></div>
            <div className="price"><div className="num">{peso(s.fee)}</div></div>
            <div className="spots"><Spots s={s} /></div>
          </Link>
        ))}
      </div>
    </>
  );
}
