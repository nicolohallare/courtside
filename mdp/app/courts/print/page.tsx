'use client';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { groupName, type Board, type BPlayer } from '@/lib/board';
import { Loading } from '@/components/Shell';

// The groupings sheet posted at the venue (content from Chris's Pickle Drop sheet, Nov 12), in the new
// app's look, filled from tonight's check-ins and the host's format (groups, late courts, free-for-all time).
const LEFT = ['Games to 11, no deuce. First to 11 wins.', 'Winners stay one more game and split partners.', 'Write your name as it appears in your DUPR account.'];
const RIGHT = ['Choose your partners and stack within your group.', 'Losing pair rotates out.', 'Winners enter the score in the app; one opponent confirms it.'];
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
  const names = groups.map((_, i) => groupName(i + 1));

  const courtList = Array.from({ length: s.courts }, (_, i) => i + 1);
  return (
    <div className="gs">
      <div className="no-print" style={{ marginBottom: 16 }}><button className="btn pink" onClick={() => window.print()}>Print or save as PDF</button></div>
      <div className="gs-band">
        <img src="/mdp-logo.webp" alt="Match Day Pickle" className="gs-logo" />
        <div>
          <div className="gs-kicker">Open play groupings</div>
          <h1 className="gs-title">{s.label}</h1>
          <div className="gs-meta">{day} · {span(start, end)} · {s.venue} · {inn.length} players</div>
        </div>
      </div>

      <div className="gs-groups" style={{ gridTemplateColumns: `repeat(${Math.min(n, 3)}, 1fr)` }}>
        {groups.map((ps, i) => (
          <div key={i} className="gs-group">
            <div className="gs-gh"><span>{names[i]}</span><small>{ps.length} players{range(ps)}</small></div>
            {ps.map((p) => <div key={p.id} className="gs-row"><span>{p.name}</span>{p.rating != null ? <b>{p.rating.toFixed(3)}</b> : <i>Not rated</i>}</div>)}
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

      <div className="gs-courts">
        {courtList.map((c) => { const t = s.court_opens?.[String(c)]; return (
          <div key={c} className={'gs-court' + (t ? ' later' : '')}><b>Court {c}</b><span>{t ? `Opens ${hm(t)} ${ap(t)}` : `From ${hm(start)} ${ap(start)}`}</span></div>
        ); })}
      </div>

      <div className="gs-card">
        <div className="gs-label">House rules</div>
        <div className="gs-rules"><ul>{LEFT.map((r) => <li key={r}>{r}</li>)}</ul><ul>{RIGHT.map((r) => <li key={r}>{r}</li>)}</ul></div>
      </div>

      <div className="gs-foot">
        <span>{free ? `Respect the groupings until ${hm(free)}. ` : ''}Share court time. Have fun!</span>
        <span className="gs-dupr">Ratings Powered by <img src="/dupr-logo.png" alt="DUPR" /></span>
      </div>
    </div>
  );
}
