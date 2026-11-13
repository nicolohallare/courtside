'use client';
// Flag a concern after a session: private, only admins see it. One flag does nothing by itself;
// admins are alerted when 3 different players flag the same person within 60 days.
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { initials } from '@/lib/format';
import { Loading, Sheet, useToast } from '@/components/Shell';

export const REASONS: { k: string; label: string }[] = [
  { k: 'rude', label: 'Rude or yelled at someone' },
  { k: 'calls', label: 'Kept arguing calls or scores' },
  { k: 'coaching', label: 'Coached people who didn\'t ask' },
  { k: 'organizing', label: 'Ignored the host\'s groupings' },
  { k: 'unsafe', label: 'Played in a way that\'s unsafe' },
  { k: 'other', label: 'Something else' },
];
export const reasonLabel = (k: string | null) => REASONS.find((r) => r.k === k)?.label ?? k ?? '';

interface Target { id: string; full_name: string; my_reason: string | null }

export function FlagSheet({ sessionId, label, onClose }: { sessionId: string; label: string; onClose: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<Target[] | null>(null);
  const [err, setErr] = useState('');
  const [who, setWho] = useState<Target | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => rpc<Target[]>('flag_targets', { p_session: sessionId })
    .then((l) => setList([...l].sort((a, b) => a.full_name.localeCompare(b.full_name)))).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(t: Target) { setWho(t); setReason(t.my_reason ?? ''); setNote(''); }
  async function send() {
    if (!who || !reason) return;
    setBusy(true);
    try {
      await rpc('flag_player', { p_session: sessionId, p_subject: who.id, p_reason: reason, p_note: note.trim() || null });
      toast('Sent to the admins. Thanks for telling us.'); setWho(null); load();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  async function takeBack() {
    if (!who) return;
    setBusy(true);
    try { await rpc('unflag_player', { p_session: sessionId, p_subject: who.id }); toast('Flag removed.'); setWho(null); load(); }
    catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  return (
    <Sheet title={who ? who.full_name : 'Flag a concern'} onClose={onClose}>
      {!who ? (<>
        <p className="small muted" style={{ marginBottom: 12 }}>{label}. Only MDP admins see this, and the player isn&apos;t told who sent it. One flag doesn&apos;t do anything by itself. Admins look into it when 3 different players flag the same person.</p>
        {err ? <div className="err">{err}</div> : !list ? <Loading rows={3} /> : list.length === 0 ? <p className="small muted">No one else played in this session.</p> : (
          <div className="roster">{list.map((t) => (
            <button key={t.id} className="prow" style={{ width: '100%', textAlign: 'left' }} onClick={() => pick(t)}>
              <span className="ini">{initials(t.full_name)}</span>
              <span className="nm" style={{ flex: 1 }}>{t.full_name}{t.my_reason && <small style={{ display: 'block' }} className="muted">You flagged: {reasonLabel(t.my_reason)}</small>}</span>
            </button>
          ))}</div>
        )}
      </>) : (<>
        <p className="small muted" style={{ marginBottom: 12 }}>What happened? Pick the closest one.</p>
        <div className="stack">
          {REASONS.map((r) => (
            <label key={r.k} className={'check' + (reason === r.k ? ' on' : '')}>
              <input type="radio" name="flag-reason" checked={reason === r.k} onChange={() => setReason(r.k)} />
              <span><b>{r.label}</b></span>
            </label>
          ))}
        </div>
        <label className="field" style={{ marginTop: 14 }}><span>Short note {reason === 'other' ? '' : '(optional)'}</span>
          <textarea id="flag-note" className="input" rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you saw, in a sentence" /></label>
        <button className="btn pink" disabled={busy || !reason || (reason === 'other' && !note.trim())} onClick={send}>{busy ? 'Sending…' : 'Send privately to admins'}</button>
        <div className="between" style={{ marginTop: 12 }}>
          <button className="link" onClick={() => setWho(null)}>Back to the list</button>
          {who.my_reason && <button className="link" disabled={busy} onClick={takeBack}>Take back my flag</button>}
        </div>
      </>)}
    </Sheet>
  );
}

interface LogRow { at: string; kind: string; reason: string | null; body: string | null; session_label: string | null; session_date: string | null; by_name: string | null }
const KIND: Record<string, string> = { flag: 'Flagged', note: 'Note', warning: 'Warning given', cleared: 'Cleared' };

/** Admin side, inside a member's sheet: every flag and note, newest first, and a box to add one. */
export function ConductLog({ memberId, onChange }: { memberId: string; onChange?: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [kind, setKind] = useState('note');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => rpc<LogRow[]>('admin_conduct_log', { p_member: memberId }).then(setRows).catch(() => setRows([]));
  useEffect(() => { setRows(null); setBody(''); load(); }, [memberId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function add() {
    setBusy(true);
    try { await rpc('admin_conduct_note', { p_member: memberId, p_kind: kind, p_body: body }); setBody(''); toast('Saved to their log.'); load(); onChange?.(); }
    catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  const people = new Set((rows ?? []).filter((r) => r.kind === 'flag').map((r) => r.by_name)).size;
  const d = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' });
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <div className="between"><div className="h3">Conduct</div>{people > 0 && <span className="tag wait">{people} player{people === 1 ? '' : 's'} flagged</span>}</div>
      {!rows ? <Loading rows={1} /> : rows.length === 0 ? <p className="small muted">Nothing logged.</p> : (
        <div className="list">{rows.map((r, i) => (
          <div key={i} style={{ display: 'block' }}>
            <div className="between"><b className="small">{KIND[r.kind] ?? r.kind}{r.reason ? `: ${reasonLabel(r.reason)}` : ''}</b><span className="small muted">{d(r.at)}</span></div>
            {r.body && <div className="small" style={{ marginTop: 2 }}>{r.body}</div>}
            <div className="small muted" style={{ marginTop: 2 }}>{r.kind === 'flag' ? `From ${r.by_name ?? 'a player'}, ${r.session_label}` : `By ${r.by_name ?? 'an admin'}`}</div>
          </div>
        ))}</div>
      )}
      <div className="chips" style={{ padding: 0 }}>
        {(['note', 'warning', 'cleared'] as const).map((k) => <button key={k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{KIND[k]}</button>)}
      </div>
      <textarea id="conduct-body" className="input" rows={2} maxLength={500} value={body} onChange={(e) => setBody(e.target.value)}
        placeholder={kind === 'warning' ? 'What you told them, and when' : kind === 'cleared' ? 'What you found' : 'What happened'} />
      <button className="btn ghost" disabled={busy || !body.trim()} onClick={add}>{busy ? 'Saving…' : 'Add to log'}</button>
      <p className="small muted">Only admins see this log. Players never see flags or who sent them.</p>
    </div>
  );
}
