'use client';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { groupName, type Board, type BPlayer } from '@/lib/board';
import { Loading } from '@/components/Shell';

// The groupings sheet posted at the venue, in MDP's own sheet design (Chris, Pickle Drop, Nov 12),
// filled from tonight's check-ins and the host's format (groups, late courts, free-for-all time).
const LEFT = ['Games to 11, no deuce. First to 11 wins.', 'Winners stay one more game and split partners.', 'Write your name as it appears in your DUPR account.'];
const RIGHT = ['Choose your partners and stack within your group.', 'Losing pair rotates out.', 'Winners enter the score in the app; one opponent confirms it.'];
const ord = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] ?? 'th');
const hm = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`; };
const ap = (t: string) => (Number(t.split(':')[0]) < 12 ? 'AM' : 'PM');
const span = (a: string, b: string) => `${hm(a)}–${hm(b)} ${ap(b)}`;

export default function PrintGroups() {
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const sid = new URLSearchParams(location.search).get('s');
    if (!sid) { setErr('No session'); return; }
    rpc<Board>('board_view', { p_session: sid }).then(setB).catch((e) => setErr((e as Error).message));
  }, []);
  if (err) return <div className="section"><div className="err">{err}</div></div>;
  if (!b) return <Loading />;
  const s = b.session;
  const inn = b.players.filter((p) => ['here', 'playing', 'resting'].includes(p.status) && p.grp);
  const n = s.groups ?? 2;
  const groups = Array.from({ length: n }, (_, i) => i + 1).map((g) => inn.filter((p) => p.grp === g).sort((x, y) => (y.rating ?? -1) - (x.rating ?? -1)));
  const rated = (ps: BPlayer[]) => ps.map((p) => p.rating).filter((x): x is number => x != null);
  const range = (ps: BPlayer[]) => { const r = rated(ps); return r.length ? ` · ${Math.min(...r).toFixed(2)}–${Math.max(...r).toFixed(2)}` : ''; };
  const day = new Date(s.session_date + 'T12:00:00+08:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const start = s.time_start.slice(0, 5), end = s.time_end.slice(0, 5), free = s.free_at ?? null;
  const opens = Object.entries(s.court_opens ?? {}).map(([c, t]) => [Number(c), t] as const).sort((x, y) => x[1].localeCompare(y[1]) || x[0] - y[0]);
  const fromStart = s.courts - opens.length;
  const tallest = Math.max(...groups.map((g) => g.length));
  const names = groups.map((_, i) => groupName(i + 1));

  return (
    <div className="gs">
      <div className="no-print" style={{ marginBottom: 16 }}><button className="btn pink" onClick={() => window.print()}>Print or save as PDF</button></div>
      <div className="gs-kicker">Match Day Pickle!</div>
      <h1 className="gs-title">Open play groupings</h1>
      <div className="gs-meta">{day} · {span(start, end)} · {s.venue} · {inn.length} players · {s.courts} courts</div>

      <div className="gs-groups" style={{ gridTemplateColumns: `repeat(${Math.min(n, 3)}, 1fr)` }}>
        {groups.map((ps, i) => (
          <div key={i} className="gs-group">
            <div className="gs-gh"><span>{names[i]}</span><small>{ps.length} players{range(ps)}</small></div>
            {ps.map((p) => <div key={p.id} className="gs-row"><span>{p.name}</span><b>{p.rating != null ? p.rating.toFixed(3) : 'NR'}</b></div>)}
            {Array.from({ length: tallest - ps.length }, (_, k) => <div key={'e' + k} className="gs-row empty" />)}
          </div>
        ))}
      </div>

      <div className="gs-phases">
        <div className="gs-phase one">
          <div className="gs-pt">{span(start, free ?? end)}</div>
          <b>Stack within your group</b>
          <p>{names.map((g) => `${g} plays ${g}`).join(', ')}. Closer ratings mean your games actually move your DUPR.</p>
        </div>
        {free && (
          <div className="gs-phase">
            <div className="gs-pt">{span(free, end)}</div>
            <b>Free for all</b>
            <p>Groups open up. Play anyone, mix partners, stack as one pool.</p>
          </div>
        )}
      </div>

      <div className="gs-box gs-courts">
        <span className="gs-label">Courts</span>
        <span><b>{fromStart} court{fromStart === 1 ? '' : 's'}</b> from {hm(start)} {ap(start)}</span>
        {opens.map(([c, t]) => <span key={c}><b>{ord(c)} court</b> opens at {hm(t)} {ap(t)}</span>)}
      </div>

      <div className="gs-box">
        <div className="gs-label">House rules</div>
        <div className="gs-rules"><ul>{LEFT.map((r) => <li key={r}>{r}</li>)}</ul><ul>{RIGHT.map((r) => <li key={r}>{r}</li>)}</ul></div>
      </div>

      <div className="gs-foot">{free ? `Respect the groupings until ${hm(free)}. ` : ''}Share court time. Have fun!</div>
    </div>
  );
}
