'use client';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { fmtClock } from '@/lib/format';
import { clock, groupName, type Board, type BPlayer } from '@/lib/board';
import { Loading } from '@/components/Shell';

// The groupings sheet to post at the venue, made from tonight's groups (Chris's Pickle Drop sheet).
const RULES = [
  'Games to 11, no deuce. First to 11 wins.',
  'Winners stay one more game and split partners.',
  'Losing pair rotates out.',
  'Choose your partners and stack within your group.',
  'One player enters the score in the app; someone from the other team confirms it.',
  'Write your name as it appears in your DUPR account.',
];

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
  const range = (ps: BPlayer[]) => { const r = ps.map((p) => p.rating).filter((x): x is number => x != null); return r.length ? `${Math.min(...r).toFixed(2)}–${Math.max(...r).toFixed(2)}` : 'Not rated'; };
  const day = new Date(s.session_date + 'T12:00:00+08:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
  const start = s.time_start.slice(0, 5), end = s.time_end.slice(0, 5);
  const opens = Object.entries(s.court_opens ?? {}).sort();
  const fromStart = s.courts - opens.length;
  return (
    <div className="print-sheet">
      <div className="no-print btn-row" style={{ marginBottom: 16 }}><button className="btn pink" onClick={() => window.print()}>Print or save as PDF</button></div>
      <div className="ps-kicker">Match Day Pickle</div>
      <h1 className="ps-title">Open play groupings</h1>
      <div className="ps-meta">{day} · {fmtClock(s.time_start)} to {fmtClock(s.time_end)} · {s.venue} · {inn.length} players · {s.courts} courts</div>
      <div className="ps-groups" style={{ gridTemplateColumns: `repeat(${Math.min(n, 3)}, 1fr)` }}>
        {groups.map((ps, i) => (
          <div key={i} className="ps-group">
            <div className="ps-gh"><span>{groupName(i + 1)}</span><span>{ps.length} players · {range(ps)}</span></div>
            {ps.map((p) => <div key={p.id} className="ps-row"><span>{p.name}</span><b>{p.rating != null ? p.rating.toFixed(3) : 'NR'}</b></div>)}
          </div>
        ))}
      </div>
      <div className="ps-phases">
        <div className="ps-phase on"><div className="ps-pt">{clock(start)}{s.free_at ? `–${clock(s.free_at)}` : `–${clock(end)}`}</div><b>Play within your group</b><p>{groups.map((_, i) => `${groupName(i + 1)} plays ${groupName(i + 1)}`).join(', ')}. Closer ratings mean your games actually move your DUPR.</p></div>
        {s.free_at && <div className="ps-phase"><div className="ps-pt">{clock(s.free_at)}–{clock(end)}</div><b>Free for all</b><p>Groups open up. Play anyone, mix partners, one line for every court.</p></div>}
      </div>
      <div className="ps-box"><b>Courts</b> {opens.length ? <>{fromStart} court{fromStart === 1 ? '' : 's'} from {clock(start)}{opens.map(([c, t]) => <span key={c}> · Court {c} opens at {clock(t)}</span>)}</> : <>All {s.courts} courts from {clock(start)}</>}</div>
      <div className="ps-box"><b>House rules</b><ul>{RULES.map((r) => <li key={r}>{r}</li>)}</ul></div>
      <div className="ps-foot">{s.free_at ? `Respect the groupings until ${clock(s.free_at)}. ` : ''}Share court time. Have fun.</div>
    </div>
  );
}
