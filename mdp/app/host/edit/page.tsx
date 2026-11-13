'use client';
import { CrowdNote } from '@/components/CrowdNote';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { rpc } from '@/lib/supabase';
import { manilaToday } from '@/lib/format';
import { loadHost, type HostSess } from '@/lib/host';
import { Band, Loading, useToast } from '@/components/Shell';

const blank = { label: '', session_date: '', time_start: '18:00', time_end: '21:00', venue: '', fee: '', max_players: '16', courts: '2', notes: '' };

// New or edited host session. Saved as a draft; the host posts it from the session page.
export default function HostEdit() {
  const router = useRouter();
  const toast = useToast();
  const [org, setOrg] = useState('');
  const [id, setId] = useState<string | null>(null);
  const [f, setF] = useState<typeof blank | null>(null);
  const [locked, setLocked] = useState(false);
  const [recent, setRecent] = useState<HostSess[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(location.search); const sid = q.get('id'); setId(sid); setOrg(q.get('org') ?? '');
    loadHost().then((orgs) => {
      const all = orgs.flatMap((o) => o.sessions.map((s) => ({ ...s, org: o.id })));
      const s = all.find((x) => x.id === sid);
      if (s) { setOrg(s.org); setLocked(s.locked); setF({ label: s.label, session_date: s.session_date, time_start: s.time_start, time_end: s.time_end, venue: s.venue, fee: String(s.fee), max_players: String(s.max_players), courts: String(s.courts ?? ''), notes: s.notes ?? '' }); }
      else { setF({ ...blank }); setRecent(all.filter((x) => !x.cancelled).slice(0, 4)); }
    }).catch(() => setF({ ...blank }));
  }, []);
  if (!f) return <Loading />;
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    try {
      const sid = await rpc<string>('host_session_save', { p: { ...f, id: id ?? '', organizer_id: org } });
      toast(id ? 'Saved' : 'Saved as a draft. Post it when you\'re ready.'); router.push('/host/session/?id=' + sid + (id ? '' : '&new=1'));
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  const fixed = locked ? { disabled: true } : {};
  return (
    <>
      <Band back={{ href: id ? '/host/session/?id=' + id : '/host/', label: 'Back' }}><h1 className="h1" style={{ marginTop: 4 }}>{id ? 'Edit session' : 'New session'}</h1>
        {locked && <p className="sub" style={{ marginTop: 6 }}>Players have booked, so the date, time, venue and fee stay as they are.</p>}</Band>
      <div className="section">
        {!id && recent.length > 0 && <div className="chips" style={{ marginBottom: 14 }}>{recent.map((r) => <button key={r.id} className="chip" onClick={() => setF({ ...f, label: r.label, venue: r.venue, time_start: r.time_start, time_end: r.time_end, fee: String(r.fee), max_players: String(r.max_players), courts: String(r.courts ?? ''), notes: r.notes ?? '' })}>Like {r.label}</button>)}</div>}
        <label className="field"><span>Name</span><input className="input" value={f.label} onChange={set('label')} placeholder="Friday Night Open Play" /></label>
        <label className="field"><span>Date</span><input className="input" type="date" min={manilaToday()} value={f.session_date} onChange={set('session_date')} {...fixed} /></label>
        <div className="btn-row"><label className="field"><span>Start</span><input className="input" type="time" value={f.time_start} onChange={set('time_start')} {...fixed} /></label><label className="field"><span>End</span><input className="input" type="time" value={f.time_end} onChange={set('time_end')} {...fixed} /></label></div>
        <label className="field"><span>Venue</span><input className="input" value={f.venue} onChange={set('venue')} placeholder="Vantage, Pasig" {...fixed} /></label>
        <div className="btn-row"><label className="field"><span>Fee per player</span><input className="input" inputMode="numeric" value={f.fee} onChange={set('fee')} {...fixed} /></label><label className="field"><span>Max players</span><input className="input" inputMode="numeric" value={f.max_players} onChange={set('max_players')} /></label><label className="field"><span>Courts</span><input className="input" inputMode="numeric" value={f.courts} onChange={set('courts')} /></label></div>
        <CrowdNote players={Number(f.max_players)} courts={Number(f.courts)} start={f.time_start} end={f.time_end} />
        <label className="field"><span>Note for players (optional)</span><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} placeholder="Level, what to bring, parking" /></label>
        <p className="small muted" style={{ marginBottom: 12 }}>Players pay through the app; every receipt is checked. What they pay is held by MDP and sent to you after the session.</p>
        <button className="btn pink" disabled={busy} onClick={save}>{busy ? 'Saving…' : id ? 'Save' : 'Save draft'}</button>
      </div>
    </>
  );
}
