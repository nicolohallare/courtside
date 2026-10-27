'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { peso, rating } from '@/lib/format';
import { eventDates, type Division, type Tournament } from '@/lib/events';
import { Band, Empty, Loading } from '@/components/Shell';
import { Icon } from '@/components/Icon';

function who(d: Division) {
  const r = d.min != null && d.max != null ? `DUPR ${rating(d.min)} to ${rating(d.max)}` : d.max != null ? `DUPR up to ${rating(d.max)}` : d.min != null ? `DUPR ${rating(d.min)} and up` : 'Open to all ratings';
  return [r, d.age_min ? `${d.age_min} and over` : null, d.gender === 'M' ? 'Men' : d.gender === 'F' ? 'Women' : d.gender === 'X' ? 'Mixed pairs' : null].filter(Boolean).join(', ');
}

export default function EventPage() {
  const { profile, userId, ready } = useMe();
  const [t, setT] = useState<Tournament | null | undefined>(undefined);
  useEffect(() => { if (ready) (userId ? rpc<Tournament | null>('current_tournament') : Promise.resolve(null)).then(setT).catch(() => setT(null)); }, [ready, userId]);

  if (t === undefined) return <Loading />;
  if (!t) return <Empty title="This event isn't open"><Link className="link" href="/events/">See all events</Link></Empty>;
  const mine = profile?.dupr_doubles ?? null;
  const fits = (d: Division) => mine != null && (d.max == null || mine <= d.max) && (d.min == null || mine >= d.min);

  return (
    <div className="has-cta">
      <Band back={{ href: '/events/', label: 'Events' }}>
        <div className="tags"><span className="tag dupr">DUPR rated</span><span className="tag">{eventDates(t)}</span></div>
        <h1 className="h1" style={{ marginTop: 10 }}>{t.name}</h1>
        {t.tagline && <p className="sub" style={{ marginTop: 4 }}>{t.tagline}</p>}
      </Band>
      {t.poster_url && <div className="section"><img src={t.poster_url} alt={`${t.name} poster`} style={{ width: '100%', borderRadius: 'var(--r)', display: 'block' }} /></div>}
      <div className="section stack">
        <div className="info-list">
          <div><Icon name="pin" /><div><b>{t.venue}</b><div className="muted small">{t.city}</div></div></div>
          {t.director && <div><Icon name="users" /><div><b>Tournament director</b><div className="muted small">{t.director}</div></div></div>}
          <div><Icon name="shield" /><div><b>DUPR required</b><div className="muted small">Teams are placed by the higher partner&apos;s rating, locked when registration closes. A second division costs less.</div></div></div>
        </div>
        {t.blurb && <p>{t.blurb}</p>}
      </div>
      <div className="section">
        <div className="section-head"><span className="h3">Divisions</span>{mine != null && <span className="sub">Your rating {rating(mine)}</span>}</div>
        {!t.divisions?.length ? <div className="card sub">Divisions are announced with registration.</div> : (
          <div className="list" style={{ display: 'block' }}>
            {t.divisions.map((d) => (
              <div key={d.name} className="division">
                <div><b>{d.name}</b>{fits(d) && <span className="tag ok" style={{ marginLeft: 6 }}>Your level</span>}<div className="small muted">{who(d)}</div>{d.spots ? <div className="small muted">{Math.max(0, d.spots - (d.taken ?? 0))} of {d.spots} teams left</div> : null}</div>
                <div className="num">{d.price != null ? peso(d.price) : ''}{d.second_price != null && <div className="small muted" style={{ fontFamily: 'var(--body)', fontWeight: 500 }}>2nd: {peso(d.second_price)}</div>}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="sticky-cta">
        <div className="hint">Register here with your partner. Your DUPR rating is checked automatically.</div>
        <button className="btn quiet" disabled>Registration opens soon</button>
      </div>
    </div>
  );
}
