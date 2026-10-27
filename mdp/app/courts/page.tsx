'use client';
import Link from 'next/link';
import { DuprLogo, DuprTag } from '@/components/Dupr';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { fmtClock, initials } from '@/lib/format';
import { LEVELS, firstName, levelName, minutesSince, myPlace, stackName, suggest, units, type Board, type BLive, type BPlayer, type Suggestion } from '@/lib/board';
import { Band, Empty, Loading, Sheet, useToast } from '@/components/Shell';
import { Icon } from '@/components/Icon';

interface Tonight { id: string; label: string; venue: string; time_start: string; time_end: string; is_dupr: boolean; is_admin: boolean; booked: boolean; players: number }

export default function Courts() {
  const toast = useToast();
  const { userId, ready } = useMe();
  const [list, setList] = useState<Tonight[] | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'me' | 'run'>('me');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | { k: 'finish'; live: BLive } | { k: 'player'; p: BPlayer } | { k: 'pick'; court: number; seats: string[] } | { k: 'partner' }>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!userId) return;
    rpc<Tonight[]>('board_tonight').then((l) => {
      setList(l);
      const want = new URLSearchParams(location.search).get('s');
      setSid(l.find((x) => x.id === want)?.id ?? l[0]?.id ?? null);
    }).catch((e) => { setErr((e as Error).message); setList([]); });
  }, [userId]);

  const load = useCallback(async () => {
    if (!sid) return;
    try { setB(await rpc<Board>('board_view', { p_session: sid })); setErr(''); } catch (e) { setErr((e as Error).message); }
  }, [sid]);
  useEffect(() => {
    if (!sid) return;
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); tick((n) => n + 1); }, 5000);
    return () => clearInterval(id);
  }, [sid, load]);
  // The host's first look seeds everyone who booked onto the sheet.
  useEffect(() => { if (mode === 'run' && sid && b?.session.is_admin) rpc('dupr_sheet_load', { p_session: sid }).then(load).catch(() => {}); }, [mode, sid, b?.session.is_admin, load]);

  const offset = useMemo(() => (b ? Date.now() - Date.parse(b.session.server_now) : 0), [b]);
  const byId = useMemo(() => new Map((b?.players ?? []).map((p) => [p.id, p])), [b]);
  const nameOf = (id: string | null) => (id ? byId.get(id)?.name ?? '?' : '');

  async function call(fn: string, args: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try { await rpc(fn, args); if (ok) toast(ok); setSheet(null); await load(); }
    catch (e) {
      const m = (e as Error).message;
      if (m.startsWith('DUPLICATE') && fn === 'dupr_board_finish') {
        setBusy(false);
        if (window.confirm('The same four players already have this exact score tonight. Save it as a separate game?')) return call(fn, { ...args, p_force: true }, ok);
        return;
      }
      toast(m, true);
    }
    setBusy(false);
  }

  if (!ready) return <Loading />;
  if (!userId) return <><Band><h1 className="h1" style={{ marginTop: 10 }}>Courts</h1></Band><Empty title="Sign in to check in on the night"><Link className="link" href="/login/?next=/courts/">Sign in</Link></Empty></>;
  if (!list) return <Loading />;
  if (!sid) return (
    <>
      <Band>
        <h1 className="h1" style={{ marginTop: 10 }}>Courts</h1>
        <p className="sub" style={{ marginTop: 6 }}>On the night of your session, this is where you check in and see when and where you play.</p>
      </Band>
      <div className="section stack">
        <div className="list">
          <div><Icon name="check" /><span className="grow"><b>Tap I&apos;m here when you arrive</b><br /><span className="small muted">No paddle stacking. You join the queue for your level.</span></span></div>
          <div><Icon name="court" /><span className="grow"><b>Get called to a court</b><br /><span className="small muted">You see your place in line and your court as soon as it frees up.</span></span></div>
          <div><Icon name="users" /><span className="grow"><b>Play with a partner, or rotate</b><br /><span className="small muted">Stay with a friend all night, or mix with new players. Change any time.</span></span></div>
          <div><Icon name="shield" /><span className="grow"><b>DUPR nights count</b><br /><span className="small muted">Scores are entered on court and sent to DUPR.</span></span></div>
        </div>
        <Link className="btn pink" href="/">Find a session</Link>
      </div>
    </>
  );

  const s = b?.session;
  const me = s?.me ? byId.get(s.me) ?? null : null;
  const partner = me?.partner_id ? byId.get(me.partner_id) ?? null : null;
  const place = me && me.status === 'here' ? myPlace(b!.players, me.id) : null;
  const myLive = me ? b!.live.find((l) => l.seats.includes(me.id)) : undefined;
  const courts = Array.from({ length: s?.courts ?? 0 }, (_, i) => i + 1);
  const liveOn = (n: number) => b?.live.find((l) => l.court === n);
  const run = mode === 'run' && !!s?.is_admin;

  // Suggested four for each free court, without double-booking a player across courts.
  const plans = new Map<number, Suggestion>();
  if (b && run) {
    const taken = new Set<string>();
    for (const n of courts) {
      if (liveOn(n)) continue;
      const sg = suggest(b.players, Date.now() - offset, taken);
      if (!sg) break;
      plans.set(n, sg); sg.seats.forEach((x) => taken.add(x));
    }
  }

  const sideNames = (ids: (string | null)[]) => ids.filter(Boolean).map((id) => <span key={id!} className={id === me?.id ? 'me' : ''}>{firstName(nameOf(id))}</span>);

  return (
    <>
      <Band>
        {list.length > 1 && (
          <div className="chips" style={{ padding: '10px 0 0' }}>
            {list.map((x) => <button key={x.id} className={'chip' + (x.id === sid ? ' on' : '')} onClick={() => { setSid(x.id); setB(null); }}>{x.label}</button>)}
          </div>
        )}
        <div className="between" style={{ marginTop: 10 }}>
          <div>
            <div className="tags">{s?.is_dupr ? <DuprTag label="Night" /> : <span className="tag">Open play</span>}</div>
            <h1 className="h2" style={{ color: '#fff', marginTop: 6 }}>{s?.label ?? list.find((x) => x.id === sid)?.label}</h1>
            {s && <p className="sub">{fmtClock(s.time_start)} to {fmtClock(s.time_end)}, {s.venue}</p>}
          </div>
        </div>
        {s?.is_admin && (
          <div className="seg" style={{ marginTop: 14 }} role="tablist">
            <button role="tab" aria-selected={!run} className={!run ? 'on' : ''} onClick={() => setMode('me')}>My night</button>
            <button role="tab" aria-selected={run} className={run ? 'on' : ''} onClick={() => setMode('run')}>Run the courts</button>
          </div>
        )}

        {s && !run && (
          <div className="status-card" style={{ marginTop: 14 }}>
            {!me || me.status === 'out' || me.status === 'no_show' ? (
              <>
                <div className="h3" style={{ color: '#fff' }}>Arrived?</div>
                <p className="sub" style={{ margin: '4px 0 12px' }}>Check in and you&apos;ll join the queue for your level. You&apos;ll see your court here.</p>
                <button className="btn pink" disabled={busy} onClick={() => call('board_check_in', { p_session: sid, p_status: 'here' }, 'You\'re checked in')}><Icon name="check" />I&apos;m here</button>
              </>
            ) : me.status === 'playing' && myLive ? (
              <>
                <div className="small">You&apos;re on</div>
                <div className="big">Court {myLive.court}</div>
                <p className="sub" style={{ marginTop: 6 }}>With {firstName(nameOf(myLive.seats.slice(0, 2).includes(me.id) ? myLive.seats.find((x, i) => i < 2 && x !== me.id) ?? null : myLive.seats.find((x, i) => i >= 2 && x !== me.id) ?? null))}, against {(myLive.seats.slice(0, 2).includes(me.id) ? myLive.seats.slice(2) : myLive.seats.slice(0, 2)).map((x) => firstName(nameOf(x))).join(' and ')}</p>
              </>
            ) : me.status === 'resting' ? (
              <>
                <div className="h3" style={{ color: '#fff' }}>On a break</div>
                <p className="sub" style={{ margin: '4px 0 12px' }}>You keep your place in line while you rest.</p>
                <button className="btn pink" disabled={busy} onClick={() => call('board_check_in', { p_session: sid, p_status: 'here' }, 'Welcome back')}>I&apos;m back</button>
              </>
            ) : (
              <>
                <div className="small">{place?.next ? 'You\'re in the next game for your group' : 'Your place in line'}</div>
                <div className="big">{place?.next ? 'Next up' : <>#{place?.pos ?? '–'}<small> in line</small></>}</div>
                <p className="sub" style={{ marginTop: 6 }}>{place?.group}. {me.games} game{me.games === 1 ? '' : 's'} played tonight.</p>
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button className="btn sm quiet" style={{ background: 'rgba(232,223,200,.12)', color: 'var(--cream)' }} disabled={busy} onClick={() => call('board_check_in', { p_session: sid, p_status: 'resting' }, 'Enjoy the break')}>Take a break</button>
                  <button className="btn sm quiet" style={{ background: 'rgba(232,223,200,.12)', color: 'var(--cream)' }} onClick={() => setSheet({ k: 'partner' })}>{partner ? `With ${firstName(partner.name)}` : 'Play with a partner'}</button>
                </div>
              </>
            )}
          </div>
        )}
      </Band>

      {err && <div className="section"><div className="err">{err}</div></div>}
      {!b && !err && <Loading rows={2} />}

      {b && (
        <>
          <div className="section">
            <div className="section-head"><span className="h3">Courts</span><span className="sub">{b.players.filter((p) => p.status === 'here').length} waiting</span></div>
            <div className="court-grid">
              {courts.map((n) => {
                const lv = liveOn(n), plan = plans.get(n);
                if (lv) return (
                  <div key={n} className="court">
                    <div className="cn"><span>Court {n}</span><span className="mins">{minutesSince(lv.started_at, offset)} min</span></div>
                    <div className="surface">
                      <div className="side">{sideNames(lv.seats.slice(0, 2))}</div>
                      <div className="net" />
                      <div className="side">{sideNames(lv.seats.slice(2))}</div>
                    </div>
                    {run && <div className="act"><button className="btn light" onClick={() => setSheet({ k: 'finish', live: lv })}>Game over</button></div>}
                  </div>
                );
                return (
                  <div key={n} className={'court free' + (run ? '' : ' quiet')}>
                    <div className="cn"><span>Court {n}</span><span>Free</span></div>
                    {run && plan ? (
                      <>
                        <div className="next-four"><b>{plan.label}</b><br />{plan.seats.slice(0, 2).map((x) => firstName(nameOf(x))).join(' & ')} vs {plan.seats.slice(2).map((x) => firstName(nameOf(x))).join(' & ')}</div>
                        <div style={{ flex: 1 }} />
                        <div className="act btn-row">
                          <button className="btn" disabled={busy} onClick={() => call('dupr_board_start', { p_session: sid, p_court: n, p_a1: plan.seats[0], p_a2: plan.seats[1], p_b1: plan.seats[2], p_b2: plan.seats[3] }, `Court ${n} started`)}>Start</button>
                          <button className="btn" style={{ background: 'transparent', color: 'var(--court)', border: '1.5px solid var(--court)' }} onClick={() => setSheet({ k: 'pick', court: n, seats: plan.seats })}>Change</button>
                        </div>
                      </>
                    ) : (
                      <div className="next-four" style={{ marginTop: 10 }}>{run ? 'Waiting for four players' : 'Next game starts soon'}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="section">
            <div className="section-head"><span className="h3">In line</span><span className="sub">{run ? 'Tap a name to edit' : 'Grouped by level'}</span></div>
            <div className="stack">
              {LEVELS.map((lv) => {
                const us = units(b.players).filter((u) => u.level === lv.k);
                if (!us.length) return null;
                let pos = 0;
                return (
                  <div key={lv.k} className="queue">
                    <div className="qh"><span>{lv.label}</span><span className="muted">{lv.range}</span></div>
                    {us.map((u) => (
                      <div key={u.ids[0]} className={'qp' + (me && u.ids.includes(me.id) ? ' me' : '')}>
                        <span className="pos">{(pos += 1)}</span>
                        <span className="nm">{u.ids.map((i) => (run ? <button key={i} style={{ fontWeight: 600 }} onClick={() => setSheet({ k: 'player', p: byId.get(i)! })}>{u.ids.length === 2 ? firstName(byId.get(i)?.name ?? '') : byId.get(i)?.name}</button> : <span key={i}>{u.ids.length === 2 ? firstName(byId.get(i)?.name ?? '') : byId.get(i)?.name}</span>)).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, ' & ', x] : [x]), [])}</span>
                        {u.ids.length === 2 && <span className="pair">Partners</span>}
                        <span className="tag off">{stackName(u.stack)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {b.players.some((p) => p.status === 'resting') && (
                <div className="queue"><div className="qh"><span>On a break</span></div>
                  {b.players.filter((p) => p.status === 'resting').map((p) => <div key={p.id} className="qp"><span className="nm">{run ? <button onClick={() => setSheet({ k: 'player', p })}>{p.name}</button> : p.name}</span></div>)}
                </div>
              )}
              {run && b.players.some((p) => p.status === 'out' || p.status === 'no_show') && (
                <div className="queue"><div className="qh"><span>Booked, not here yet</span></div>
                  {b.players.filter((p) => p.status === 'out' || p.status === 'no_show').map((p) => (
                    <div key={p.id} className="qp"><span className="nm">{p.name}</span><button className="btn sm green inline" onClick={() => call('dupr_board_status', { p_player: p.id, p_status: 'here' }, `${firstName(p.name)} checked in`)}>Check in</button></div>
                  ))}
                </div>
              )}
              {units(b.players).length === 0 && !b.players.some((p) => p.status === 'resting') && <div className="card sub">No one is waiting. Players appear here when they tap I&apos;m here.</div>}
            </div>
          </div>

          <div className="section">
            <div className="section-head"><span className="h3">Tonight&apos;s scores</span>{s?.is_dupr && <DuprTag label="Sent after review" />}</div>
            {b.games.length === 0 ? <div className="card sub">{s?.is_dupr ? 'Scores show here as games finish.' : 'Open play scores are optional. Games ended with a winner only don\'t show here.'}</div> : (
              <div className="list" style={{ display: 'block' }}>
                {b.games.slice(0, 20).map((g) => {
                  const aWon = g.score_a > g.score_b;
                  return (
                    <div key={g.id} className="score-row">
                      <span className={aWon ? 'w' : ''}>{g.seats.slice(0, 2).filter(Boolean).map((x) => firstName(nameOf(x))).join(' & ')}</span>
                      <span className="sc">{g.score_a}–{g.score_b}</span>
                      <span className={'r ' + (!aWon ? 'w' : '')}>{g.seats.slice(2).filter(Boolean).map((x) => firstName(nameOf(x))).join(' & ')}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {s?.is_admin && s.is_dupr && <Link className="btn dupr" style={{ marginTop: 12 }} href={'/courts/results/?s=' + sid}>Review and send to <DuprLogo h={13} light /></Link>}
          </div>
        </>
      )}

      {sheet?.k === 'finish' && b && <FinishSheet live={sheet.live} dupr={b.session.is_dupr} nameOf={nameOf} busy={busy} onClose={() => setSheet(null)}
        onScore={(a, z) => call('dupr_board_finish', { p_live: sheet.live.id, p_score_a: a, p_score_b: z, p_force: false }, `Court ${sheet.live.court} is free`)}
        onWinner={(w) => call('board_finish_quick', { p_live: sheet.live.id, p_winner: w }, `Court ${sheet.live.court} is free`)}
        onCancel={() => call('dupr_board_cancel', { p_live: sheet.live.id }, 'Game cancelled. Players are back in line.')} />}

      {sheet?.k === 'pick' && b && <PickSheet court={sheet.court} initial={sheet.seats} players={b.players.filter((p) => p.status === 'here')} busy={busy} onClose={() => setSheet(null)}
        onStart={(x) => call('dupr_board_start', { p_session: sid, p_court: sheet.court, p_a1: x[0], p_a2: x[1], p_b1: x[2], p_b2: x[3] }, `Court ${sheet.court} started`)} />}

      {sheet?.k === 'partner' && b && me && (
        <Sheet title="Play with a partner" onClose={() => setSheet(null)}>
          <p className="sub" style={{ marginBottom: 12 }}>You&apos;ll stay on the same side for every game and wait in line together. Either of you can split any time.</p>
          {partner && <button className="btn ghost" style={{ marginBottom: 12 }} disabled={busy} onClick={() => call('board_partner', { p_session: sid, p_a: me.id, p_b: null }, 'Back to rotating')}>Split from {firstName(partner.name)}, rotate again</button>}
          <div className="list">
            {b.players.filter((p) => p.id !== me.id && !p.partner_id && ['here', 'resting', 'playing'].includes(p.status)).map((p) => (
              <button key={p.id} style={{ width: '100%', textAlign: 'left' }} disabled={busy} onClick={() => call('board_partner', { p_session: sid, p_a: me.id, p_b: p.id }, `You're playing with ${firstName(p.name)}`)}>
                <span className="avatar" style={{ background: 'var(--ink)', color: 'var(--cream)', width: 32, height: 32, fontSize: 12 }}>{initials(p.name)}</span>
                <span className="grow">{p.name}<br /><span className="small muted">{levelName(p.level)}</span></span>
                {p.rating ? <span className="rating">{Number(p.rating).toFixed(2)}</span> : null}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {sheet?.k === 'player' && b && (() => {
        const p = byId.get(sheet.p.id) ?? sheet.p; const mate = p.partner_id ? byId.get(p.partner_id) : null;
        return (
          <Sheet title={p.name} onClose={() => setSheet(null)}>
            <p className="sub" style={{ marginBottom: 12 }}>{p.rating ? `DUPR ${Number(p.rating).toFixed(2)}` : 'No DUPR rating'}{!p.linked && s?.is_dupr ? '. DUPR not connected, so games can\'t be sent for them.' : ''}. {p.games} games tonight.</p>
            <div className="field"><span>Level</span>
              <div className="seg">{LEVELS.filter((l) => l.k !== '?').map((l) => <button key={l.k} className={p.level === l.k ? 'on' : ''} disabled={busy} onClick={() => call('dupr_board_move', { p_player: p.id, p_level: l.k, p_stack: null, p_front: false })}>{l.label.replace('-Intermediate', '-Int')}</button>)}</div>
            </div>
            <div className="field"><span>Status</span>
              <div className="btn-row">
                {p.status !== 'here' && <button className="btn sm green" disabled={busy} onClick={() => call('dupr_board_status', { p_player: p.id, p_status: 'here' })}>Here</button>}
                {p.status === 'here' && <button className="btn sm quiet" disabled={busy} onClick={() => call('dupr_board_move', { p_player: p.id, p_level: null, p_stack: null, p_front: true }, `${firstName(p.name)} is first in line`)}>Front of line</button>}
                {p.status !== 'resting' && <button className="btn sm quiet" disabled={busy} onClick={() => call('dupr_board_status', { p_player: p.id, p_status: 'resting' })}>Break</button>}
                <button className="btn sm quiet" disabled={busy} onClick={() => call('dupr_board_status', { p_player: p.id, p_status: 'out' })}>Left</button>
              </div>
            </div>
            <div className="field"><span>Partner</span>
              {mate ? <button className="btn ghost" disabled={busy} onClick={() => call('board_partner', { p_session: sid, p_a: p.id, p_b: null })}>Split from {mate.name}</button>
                : <select className="input" defaultValue="" onChange={(e) => e.target.value && call('board_partner', { p_session: sid, p_a: p.id, p_b: e.target.value })}>
                    <option value="">Rotating. Pick a partner…</option>
                    {b.players.filter((x) => x.id !== p.id && !x.partner_id && ['here', 'resting', 'playing'].includes(x.status)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>}
            </div>
          </Sheet>
        );
      })()}
    </>
  );
}

function FinishSheet({ live, dupr, nameOf, busy, onClose, onScore, onWinner, onCancel }: {
  live: BLive; dupr: boolean; nameOf: (id: string | null) => string; busy: boolean; onClose: () => void;
  onScore: (a: number, b: number) => void; onWinner: (w: 'A' | 'B') => void; onCancel: () => void;
}) {
  const [a, setA] = useState(dupr ? 11 : 0), [z, setZ] = useState(dupr ? 0 : 0);
  const [scored, setScored] = useState(dupr);
  const team = (ids: (string | null)[]) => ids.filter(Boolean).map((x) => nameOf(x)).join(' and ');
  const box = (label: string, v: number, set: (n: number) => void) => (
    <div className="team-box"><div className="small" style={{ fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div className="stepper"><button aria-label="Minus one" onClick={() => set(Math.max(0, v - 1))}>−</button><div className="num">{v}</div><button aria-label="Plus one" onClick={() => set(Math.min(30, v + 1))}>+</button></div></div>
  );
  return (
    <Sheet title={`Court ${live.court}: game over`} onClose={onClose}>
      {!dupr && (
        <div className="seg" style={{ marginBottom: 14 }}>
          <button className={!scored ? 'on' : ''} onClick={() => setScored(false)}>Who won</button>
          <button className={scored ? 'on' : ''} onClick={() => { setScored(true); setA(11); }}>Enter the score</button>
        </div>
      )}
      {scored ? (
        <>
          {box(team(live.seats.slice(0, 2)), a, setA)}
          {box(team(live.seats.slice(2)), z, setZ)}
          <button className="btn pink" style={{ marginTop: 14 }} disabled={busy || a === z} onClick={() => onScore(a, z)}>{a === z ? 'Scores can\'t tie' : `Save ${a}–${z}`}</button>
          {dupr && <p className="small muted" style={{ textAlign: 'center', marginTop: 8 }}>The score is checked by MDP before it goes to DUPR.</p>}
        </>
      ) : (
        <div className="stack">
          <button className="btn green" disabled={busy} onClick={() => onWinner('A')}>{team(live.seats.slice(0, 2))} won</button>
          <button className="btn green" disabled={busy} onClick={() => onWinner('B')}>{team(live.seats.slice(2))} won</button>
        </div>
      )}
      <button className="btn ghost" style={{ marginTop: 12 }} disabled={busy} onClick={onCancel}>Cancel game, nobody played</button>
    </Sheet>
  );
}

function PickSheet({ court, initial, players, busy, onClose, onStart }: { court: number; initial: string[]; players: BPlayer[]; busy: boolean; onClose: () => void; onStart: (x: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(initial);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 4 ? [...s, id] : s));
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  return (
    <Sheet title={`Court ${court}: pick four`} onClose={onClose}>
      <p className="sub" style={{ marginBottom: 10 }}>The first two you pick play together.</p>
      <div className="card" style={{ marginBottom: 12 }}>
        <b>{sel.slice(0, 2).map(name).join(' & ') || '…'}</b> <span className="muted">vs</span> <b>{sel.slice(2).map(name).join(' & ') || '…'}</b>
      </div>
      <div className="list" style={{ marginBottom: 12 }}>
        {players.map((p) => {
          const i = sel.indexOf(p.id);
          return (
            <button key={p.id} style={{ width: '100%', textAlign: 'left', background: i >= 0 ? 'rgba(224,53,122,.07)' : undefined }} onClick={() => toggle(p.id)}>
              <span className="avatar" style={{ width: 30, height: 30, fontSize: 12, background: i >= 0 ? 'var(--pink)' : 'rgba(13,27,42,.08)', color: i >= 0 ? '#fff' : 'var(--muted)' }}>{i >= 0 ? i + 1 : ''}</span>
              <span className="grow">{p.name}<br /><span className="small muted">{levelName(p.level)}, {stackName(p.stack)}</span></span>
              {p.rating ? <span className="rating">{Number(p.rating).toFixed(2)}</span> : null}
            </button>
          );
        })}
      </div>
      <button className="btn pink" disabled={busy || sel.length !== 4} onClick={() => onStart(sel)}>{sel.length === 4 ? `Start court ${court}` : `Pick ${4 - sel.length} more`}</button>
    </Sheet>
  );
}
