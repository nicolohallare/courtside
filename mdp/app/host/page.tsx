'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMe } from '@/lib/me';
import { fmtClock, fmtDate, manilaToday, peso } from '@/lib/format';
import { loadHost, type Org } from '@/lib/host';
import { Band, Empty, Loading } from '@/components/Shell';
import { Icon } from '@/components/Icon';

// The host's home: their group's sessions, who's paid, and what the club owes them.
export default function Host() {
  const { userId, ready } = useMe();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  useEffect(() => { if (userId) loadHost().then(setOrgs).catch(() => setOrgs([])); }, [userId]);
  if (!ready || (userId && !orgs)) return <Loading />;
  if (!userId || !orgs?.length) return <><Band><h1 className="h1" style={{ marginTop: 10 }}>Host</h1></Band><Empty title="You're not a host yet"><p className="sub">Ask MDP to set up your group.</p></Empty></>;
  const today = manilaToday();
  return (
    <>
      {orgs.map((o) => {
        const up = o.sessions.filter((s) => s.session_date >= today && !s.cancelled).sort((a, b) => a.session_date.localeCompare(b.session_date));
        const past = o.sessions.filter((s) => s.session_date < today || s.cancelled).slice(0, 6);
        const p = o.payouts;
        return (
          <div key={o.id}>
            <Band>
              <div className="small" style={{ color: 'var(--gold)', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 10 }}>Host</div>
              <h1 className="h1" style={{ marginTop: 2 }}>{o.name}</h1>
              <div className="btn-row" style={{ marginTop: 14 }}>
                <Link className="btn pink" href={'/host/edit/?org=' + o.id}><Icon name="plus" />New session</Link>
              </div>
            </Band>
            {p && (p.due_net > 0 || p.held_gross > 0 || p.history.length > 0) && (
              <div className="section">
                <div className="card stack">
                  <div className="between"><b>Owed to you</b><span className="num" style={{ fontWeight: 800, fontSize: 20 }}>{peso(p.due_net)}</span></div>
                  <p className="small muted">From {p.due_count} paid player{p.due_count === 1 ? '' : 's'} at finished sessions{p.due_fee ? `, after the ${peso(p.due_fee)} MDP fee` : ''}. {p.held_gross > 0 ? `${peso(p.held_gross)} more is held until those sessions are played.` : ''}</p>
                  {p.history[0] && <p className="small">Last payout {peso(p.history[0].amount)} on {fmtDate(p.history[0].sent_at.slice(0, 10))}{p.history[0].reference ? `, ref ${p.history[0].reference}` : ''}.</p>}
                </div>
              </div>
            )}
            <div className="section">
              <div className="section-head"><span className="h3">Coming up</span></div>
              {up.length === 0 && <div className="card sub">No sessions yet. Post one and share the link on Reclub or Viber.</div>}
              {up.map((s) => (
                <Link key={s.id} href={'/host/session/?id=' + s.id} className="card" style={{ display: 'block', marginBottom: 10 }}>
                  <div className="between"><span className="small muted" style={{ fontWeight: 700 }}>{fmtDate(s.session_date)}, {fmtClock(s.time_start)}</span><span className="num" style={{ fontWeight: 800 }}>{s.seats}/{s.max_players}</span></div>
                  <div className="h3" style={{ marginTop: 2 }}>{s.label}</div>
                  <div className="small muted">{s.venue}, {peso(s.fee)}</div>
                  <div className="counts">
                    {!s.published && <span className="tag off">Draft, not posted</span>}
                    <span className="tag ok">{s.paid} paid</span>
                    {s.pending > 0 && <span className="tag wait">{s.pending} checking</span>}
                    {s.requests > 0 && <span className="tag host">{s.requests} want to join</span>}
                    {s.screening && <span className="tag">You approve players</span>}
                    {!s.proof && s.published && <span className="tag off">Court proof missing</span>}
                  </div>
                </Link>
              ))}
            </div>
            {past.length > 0 && (
              <div className="section">
                <div className="section-head"><span className="h3">Recent</span></div>
                <div className="list">{past.map((s) => (
                  <Link key={s.id} href={'/host/session/?id=' + s.id}><span className="grow"><b>{s.label}</b><br /><span className="small muted">{fmtDate(s.session_date)}{s.cancelled ? ', cancelled' : `, ${s.paid} paid`}</span></span><Icon name="chev" className="chev" /></Link>
                ))}</div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
