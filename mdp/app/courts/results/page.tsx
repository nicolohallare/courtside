'use client';
import Link from 'next/link';
import { DuprLogo, DuprTag } from '@/components/Dupr';
import { useCallback, useEffect, useState } from 'react';
import { fn, rpc } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { fmtDate } from '@/lib/format';
import { firstName } from '@/lib/board';
import { Band, Empty, Loading, Sheet, useToast } from '@/components/Shell';
import { Icon } from '@/components/Icon';

// Results for DUPR: every scored game of a night, checked by an admin, then sent to DUPR
// under the Match Day Pickle club. Sent games can still be fixed or removed on DUPR.

interface Seat { sheet_id: string | null; profile_id: string | null; name: string; dupr: string | null }
interface Game { id: string; status: string; format: string; court: number | null; game_no: number | null; score_a: number; score_b: number; seats: (Seat | null)[] }
interface SheetPlayer { id: string; profile_id: string | null; name: string; linked: boolean }
interface Loaded { session: { id: string; label: string; session_date: string }; players: SheetPlayer[]; games: Game[] }
interface SessRow { id: string; label: string; session_date: string; is_dupr: boolean; games: number }
interface Held { id: string; needs_connect?: string[]; not_eligible?: string[]; error?: string }

const STATUS: Record<string, { text: string; cls: string }> = {
  approved: { text: 'Ready to send', cls: 'wait' },
  submitted: { text: 'On DUPR', cls: 'ok' },
  pending_review: { text: 'Check score', cls: 'wait' },
  needs_dupr: { text: 'Player not on DUPR', cls: 'off' },
};

export default function Results() {
  const toast = useToast();
  const { userId, ready, profile } = useMe();
  const [list, setList] = useState<SessRow[] | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [d, setD] = useState<Loaded | null>(null);
  const [held, setHeld] = useState<Record<string, Held>>({});
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Game | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!userId) return;
    rpc<SessRow[]>('dupr_sheet_sessions').then((l) => {
      const games = l.filter((x) => x.games > 0 || x.is_dupr);
      setList(games);
      const want = new URLSearchParams(location.search).get('s');
      setSid(games.find((x) => x.id === want)?.id ?? games.find((x) => x.games > 0)?.id ?? games[0]?.id ?? null);
    }).catch((e) => { setErr((e as Error).message); setList([]); });
  }, [userId]);

  const load = useCallback(async () => {
    if (!sid) return;
    try { setD(await rpc<Loaded>('dupr_sheet_load', { p_session: sid })); setErr(''); } catch (e) { setErr((e as Error).message); }
  }, [sid]);
  useEffect(() => { setD(null); setHeld({}); load(); }, [load]);

  if (!ready) return <Loading />;
  if (!userId) return <Empty title="Sign in first"><Link className="link" href="/login/?next=/courts/results/">Sign in</Link></Empty>;
  if (profile && !profile.is_admin && !profile.super_admin) return <Empty title="For MDP admins">Results are checked and sent to DUPR by the club.</Empty>;

  const linked = new Map((d?.players ?? []).map((p) => [p.id, p.linked]));
  const team = (s: (Seat | null)[]) => s.filter(Boolean).map((x) => firstName(x!.name)).join(' & ');
  const notLinked = (g: Game) => g.seats.filter((s) => s && s.sheet_id && linked.get(s.sheet_id) === false).map((s) => firstName(s!.name));
  const games = d?.games ?? [];
  const ready_ = games.filter((g) => g.status === 'approved' && notLinked(g).length === 0);
  const waiting = games.filter((g) => g.status === 'approved' && notLinked(g).length > 0);
  const sent = games.filter((g) => g.status === 'submitted');

  async function send() {
    if (!sid) return;
    setBusy(true);
    try {
      const r = await fn<{ sent: number; held: Held[] }>('dupr', 'send-session', { session_id: sid });
      setHeld(Object.fromEntries(r.held.map((h) => [h.id, h])));
      toast(r.sent ? `${r.sent} game${r.sent === 1 ? '' : 's'} sent to DUPR${r.held.length ? `. ${r.held.length} held back, see below.` : ''}` : r.held.length ? `Nothing sent. ${r.held.length} game${r.held.length === 1 ? ' needs' : 's need'} attention.` : 'Nothing new to send.', !r.sent && r.held.length > 0);
      await load();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  return (
    <>
      <Band back={{ href: '/courts/', label: 'Courts' }}>
        <h1 className="h1" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 12 }}>Results for <DuprLogo h={28} light /></h1>
        <p className="sub" style={{ marginTop: 6 }}>Check the scores, then send them to DUPR under the Match Day Pickle club. Ratings update by themselves once DUPR processes them.</p>
        {list && list.length > 1 && (
          <div className="chips" style={{ padding: '12px 0 0' }}>
            {list.map((x) => <button key={x.id} className={'chip' + (x.id === sid ? ' on' : '')} onClick={() => setSid(x.id)}>{x.label}, {fmtDate(x.session_date)}</button>)}
          </div>
        )}
        {d && (
          <div className="facts">
            <div><div className="k">Games</div><div className="v num">{games.length}</div></div>
            <div><div className="k">Ready</div><div className="v num">{ready_.length}</div></div>
            <div><div className="k">On DUPR</div><div className="v num">{sent.length}</div></div>
          </div>
        )}
      </Band>

      {err && <div className="section"><div className="err">{err}</div></div>}
      {!list ? <Loading /> : !sid ? <Empty title="No games from the last week">Scores entered on the court board show up here.</Empty> : !d ? <Loading rows={3} /> : (
        <>
          <div className="section stack">
            {games.length === 0 && <div className="card sub">No scored games for this session yet.</div>}
            {games.map((g) => {
              const h = held[g.id], missing = notLinked(g), aWon = g.score_a > g.score_b;
              const st = g.status === 'approved' && missing.length ? { text: 'Waiting for DUPR accounts', cls: 'off' } : STATUS[g.status] ?? { text: g.status, cls: 'off' };
              return (
                <button key={g.id} className="card" style={{ width: '100%', textAlign: 'left' }} onClick={() => setEdit(g)}>
                  <div className="between"><span className="small muted">Game {g.game_no ?? '–'}{g.court ? `, court ${g.court}` : ''}</span><span className={'tag ' + st.cls}>{st.text}</span></div>
                  <div className="score-row" style={{ padding: '8px 0 0' }}>
                    <span className={aWon ? 'w' : ''}>{team(g.seats.slice(0, 2))}</span>
                    <span className="sc">{g.score_a}–{g.score_b}</span>
                    <span className={'r ' + (!aWon ? 'w' : '')}>{team(g.seats.slice(2))}</span>
                  </div>
                  {g.status !== 'submitted' && missing.length > 0 && <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>{missing.join(' and ')} {missing.length === 1 ? 'hasn\'t' : 'haven\'t'} connected DUPR yet. This game goes to DUPR once {missing.length === 1 ? 'they connect' : 'they all connect'}; the rest can be sent now.</div>}
                  {h && !missing.length && <div className="small" style={{ color: 'var(--pink-d)', marginTop: 6 }}>
                    {h.needs_connect?.length ? `Held: ${h.needs_connect.join(', ')} must connect DUPR in the app. ` : ''}
                    {h.not_eligible?.length ? `Held: DUPR says ${h.not_eligible.join(', ')} can't play rated games. ` : ''}
                    {h.error ? `DUPR said: ${h.error}` : ''}
                  </div>}
                </button>
              );
            })}
          </div>
          <div className="section stack">
            <button className="btn dupr" disabled={busy || ready_.length === 0} onClick={send}><Icon name="upload" />{busy ? 'Sending to DUPR…' : ready_.length ? `Send ${ready_.length} game${ready_.length === 1 ? '' : 's'} to DUPR` : waiting.length ? `${waiting.length} game${waiting.length === 1 ? '' : 's'} waiting for DUPR accounts` : 'Everything is on DUPR'}</button>
            <p className="small muted" style={{ textAlign: 'center' }}>Only club directors and organizers on DUPR can send. Games with a player who hasn&apos;t connected DUPR are held back and can be sent later.</p>
          </div>
        </>
      )}

      {edit && sid && <EditSheet g={edit} sid={sid} busy={busy} onClose={() => setEdit(null)} onDone={async (m) => { setEdit(null); toast(m); await load(); }} setBusy={setBusy} toast={toast} team={team} />}
    </>
  );
}

function EditSheet({ g, sid, busy, setBusy, onClose, onDone, toast, team }: {
  g: Game; sid: string; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void; onDone: (msg: string) => void;
  toast: (m: string, bad?: boolean) => void; team: (s: (Seat | null)[]) => string;
}) {
  const [a, setA] = useState(g.score_a), [b, setB] = useState(g.score_b);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const onDupr = g.status === 'submitted';
  const box = (label: string, v: number, set: (n: number) => void) => (
    <div className="team-box"><div className="small" style={{ fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div className="stepper"><button aria-label="Minus one" onClick={() => set(Math.max(0, v - 1))}>−</button><div className="num">{v}</div><button aria-label="Plus one" onClick={() => set(Math.min(30, v + 1))}>+</button></div></div>
  );
  async function save() {
    setBusy(true);
    try {
      if (onDupr) {
        const r = await fn<{ method?: string }>('dupr', 'update-match', { record_id: g.id, score_a: a, score_b: b });
        onDone(r.method === 'replaced' ? 'Score fixed on DUPR. DUPR wouldn\'t edit it, so the game was replaced with the corrected score.' : 'Score fixed on DUPR');
        setBusy(false); return;
      }
      await rpc('dupr_sheet_game_save', { p_session: sid, p_game: g.id, p_seats: g.seats.map((s) => s?.sheet_id ?? null), p_score_a: a, p_score_b: b, p_court: g.court, p_game_no: g.game_no, p_force: true });
      onDone('Score saved');
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  async function remove() {
    setBusy(true);
    try {
      if (onDupr) { await fn('dupr', 'remove-match', { record_id: g.id }); onDone('Removed from DUPR. The game stays here so you can fix and resend it.'); }
      else { await rpc('dupr_sheet_game_delete', { p_game: g.id }); onDone('Game removed'); }
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  return (
    <Sheet title={`Game ${g.game_no ?? ''}`} onClose={onClose}>
      {onDupr && <p className="sub" style={{ marginBottom: 12 }}>This game is on DUPR. A new score is sent to DUPR straight away. It can take up to a minute.</p>}
      {box(team(g.seats.slice(0, 2)), a, setA)}
      {box(team(g.seats.slice(2)), b, setB)}
      <button className="btn pink" style={{ marginTop: 14 }} disabled={busy || a === b || (a === g.score_a && b === g.score_b)} onClick={save}>{a === b ? 'Scores can\'t tie' : onDupr ? `Fix on DUPR: ${a}–${b}` : `Save ${a}–${b}`}</button>
      {!confirmRemove
        ? <button className="btn ghost" style={{ marginTop: 10 }} disabled={busy} onClick={() => setConfirmRemove(true)}>{onDupr ? 'Remove from DUPR' : 'Delete this game'}</button>
        : <div className="card" style={{ marginTop: 10 }}>
            <p className="small" style={{ marginBottom: 10 }}>{onDupr ? 'DUPR takes the game off all four players\' records and recalculates their ratings.' : 'The game is deleted from tonight\'s results.'}</p>
            <div className="btn-row"><button className="btn sm ghost" onClick={() => setConfirmRemove(false)}>Keep it</button><button className="btn sm pink" disabled={busy} onClick={remove}>{onDupr ? 'Remove from DUPR' : 'Delete'}</button></div>
          </div>}
    </Sheet>
  );
}
