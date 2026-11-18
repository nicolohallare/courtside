'use client';
// Shared screen for the venue: a TV or tablet by the courts shows who's on each court and who's next.
// Read-only. The host opens it once (signed in) and leaves it running; it refreshes every 5 seconds.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { rpc } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { LEVELS, clock, firstName, groupName, lineUnits, minutesSince, nextGroup, stackName, suggest, units, type Board, type Suggestion } from '@/lib/board';

export default function CourtScreen() {
  const { userId, ready } = useMe();
  const [sid, setSid] = useState<string | null>(null);
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState('');
  const [, tick] = useState(0);

  useEffect(() => {
    if (!userId) return;
    const want = new URLSearchParams(location.search).get('s');
    if (want) { setSid(want); return; }
    rpc<{ id: string }[]>('board_tonight').then((l) => (l[0] ? setSid(l[0].id) : setErr('No open play tonight.'))).catch((e) => setErr((e as Error).message));
  }, [userId]);

  useEffect(() => {
    if (!sid) return;
    const load = () => rpc<Board>('board_view', { p_session: sid }).then((x) => { setB(x); setErr(''); }).catch((e) => setErr((e as Error).message));
    load();
    const id = setInterval(() => { load(); tick((n) => n + 1); }, 5000);
    return () => clearInterval(id);
  }, [sid]);

  // Keep the screen awake while it's showing.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const get = () => nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    get();
    const vis = () => { if (document.visibilityState === 'visible') get(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release().catch(() => {}); };
  }, []);

  const offset = useMemo(() => (b ? Date.now() - Date.parse(b.session.server_now) : 0), [b]);
  const byId = useMemo(() => new Map((b?.players ?? []).map((p) => [p.id, p])), [b]);
  const nm = (id: string | null) => (id ? firstName(byId.get(id)?.name ?? '?') : '');
  const full = (id: string) => byId.get(id)?.name ?? '?';

  if (!ready) return <div className="scr"><div className="scr-msg">Loading…</div></div>;
  if (!userId) return <div className="scr"><div className="scr-msg">Sign in as the host on this screen.<br /><Link href="/login/?next=/courts/screen/">Sign in</Link></div></div>;
  if (err && !b) return <div className="scr"><div className="scr-msg">{err}<br /><Link href="/courts/">Back to the court board</Link></div></div>;
  if (!b) return <div className="scr"><div className="scr-msg">Loading the courts…</div></div>;

  const s = b.session;
  const groups = s.format === 'groups';
  const free = groups && s.phase === 'free';
  const lines = free ? [0] : Array.from({ length: s.groups ?? 2 }, (_, i) => i + 1);
  const courts = Array.from({ length: s.courts }, (_, i) => i + 1);
  const liveOn = (n: number) => b.live.find((l) => l.court === n);
  const opensAt = (n: number) => s.court_opens?.[String(n)] ?? null;
  const closed = (n: number) => { const t = opensAt(n); return !!t && Date.now() - offset < Date.parse(`${s.session_date}T${t}:00+08:00`); };
  const upNext = groups ? nextGroup(b.players, b.live, lines) : null;
  const plans = new Map<number, Suggestion>();
  if (!groups) {
    const taken = new Set<string>();
    for (const n of courts) { if (liveOn(n) || closed(n)) continue; const sg = suggest(b.players, Date.now() - offset, taken); if (!sg) break; plans.set(n, sg); sg.seats.forEach((x) => taken.add(x)); }
  }
  const waiting = b.players.filter((p) => p.status === 'here').length;
  // Who plays next: the four called for the next free court (or each free court's planned four).
  const nextIds = new Set<string>([...(upNext?.four ?? []), ...[...plans.values()].flatMap((p) => p.seats)]);
  const now = new Date(Date.now() - offset).toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });

  // The waiting lines: per group (groups format) or per level and stack (levels format).
  const queues: { title: string; sub?: string; units: string[][] }[] = groups
    ? lines.map((n) => ({ title: n === 0 ? 'Free for all' : groupName(n), units: lineUnits(b.players, n) }))
    : LEVELS.flatMap((lv) => ['W', 'L'].map((st) => ({ title: lv.label, sub: stackName(st), units: units(b.players).filter((u) => u.level === lv.k && u.stack === st).map((u) => u.ids) })));
  const shown = queues.filter((q) => q.units.length);

  return (
    <div className="scr">
      <header className="scr-top">
        <img src="/mdp-logo.webp" alt="" className="scr-logo" />
        <div className="scr-title">
          <div className="scr-h">{s.label}</div>
          <div className="scr-sub">{s.venue} · {clock(s.time_start.slice(0, 5))} to {clock(s.time_end.slice(0, 5))}{groups ? (free ? ' · Free for all' : ` · ${lines.length} groups by DUPR`) : ''}</div>
        </div>
        <div className="scr-clock">{now}</div>
      </header>

      <main className="scr-main">
        <section className="scr-courts" style={{ gridTemplateColumns: `repeat(${courts.length > 4 ? 3 : 2}, minmax(0, 1fr))` }}>
          {courts.map((n) => {
            const lv = liveOn(n);
            if (lv) {
              const g = groups && !free ? byId.get(lv.seats[0] ?? '')?.grp : null;
              return (
                <div key={n} className="scr-court">
                  <div className="scr-cn"><span>Court {n}{g ? ` · ${groupName(g)}` : ''}</span><span>{minutesSince(lv.started_at, offset)} min</span></div>
                  <div className="scr-surface">
                    <div className="scr-side">{lv.seats.slice(0, 2).filter(Boolean).map((x) => <span key={x}>{nm(x)}</span>)}</div>
                    <div className="scr-net" />
                    <div className="scr-side">{lv.seats.slice(2).filter(Boolean).map((x) => <span key={x}>{nm(x)}</span>)}</div>
                  </div>
                </div>
              );
            }
            const plan = plans.get(n);
            return (
              <div key={n} className="scr-court free">
                <div className="scr-cn"><span>Court {n}</span><span>{closed(n) ? `Opens ${clock(opensAt(n)!)}` : 'Free'}</span></div>
                <div className="scr-next">
                  {closed(n) ? `Opens at ${clock(opensAt(n)!)}`
                    : groups && upNext ? <><b>Next{free ? '' : `, ${groupName(upNext.line)}`}</b>{upNext.four.map(nm).join(', ')}</>
                    : plan ? <><b>Next</b>{plan.seats.slice(0, 2).map(nm).join(' & ')} vs {plan.seats.slice(2).map(nm).join(' & ')}</>
                    : 'Waiting for four players'}
                </div>
              </div>
            );
          })}
        </section>

        <aside className="scr-lines">
          <div className="scr-lh"><span>In line</span><span>{waiting} waiting</span></div>
          {shown.length === 0 && <div className="scr-empty">No one is waiting. Tap I&apos;m here in the MDP app when you arrive, or tell the host.</div>}
          {shown.map((q) => (
            <div key={q.title + (q.sub ?? '')} className="scr-q">
              <div className="scr-qh"><span>{q.title}</span>{q.sub && <span className="muted">{q.sub}</span>}</div>
              {q.units.slice(0, 8).map((u, i) => {
                return (
                  <div key={u[0]} className={'scr-qp' + (u.some((x) => nextIds.has(x)) ? ' up' : '')}>
                    <span className="pos">{i + 1}</span>
                    <span className="nm">{u.length === 2 ? `${nm(u[0])} & ${nm(u[1])}` : full(u[0])}</span>
                    {u.length === 2 && <span className="pair">Partners</span>}
                  </div>
                );
              })}
              {q.units.length > 8 && <div className="scr-more">+{q.units.slice(8).flat().length} more</div>}
            </div>
          ))}
        </aside>
      </main>

      <footer className="scr-foot">
        <span>Arrived? Tap <b>I&apos;m here</b> in the MDP app, or tell the host.</span>
        <span>Highlighted names play next. Winners stay one game, then split.</span>
        <button className="scr-fs" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>Full screen</button>
      </footer>
    </div>
  );
}
