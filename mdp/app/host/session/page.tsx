'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { rpc, sb } from '@/lib/supabase';
import { fmtClock, fmtDate, manilaToday, peso, rating } from '@/lib/format';
import { announcement, shareText } from '@/lib/announce';
import { loadHost, type Cand, type HostSess, type Org, type Req, type RosterRow } from '@/lib/host';
import { Band, Empty, Loading, Sheet, useToast } from '@/components/Shell';
import { Icon } from '@/components/Icon';

const ST: Record<string, { t: string; c: string }> = { paid: { t: 'Paid', c: 'ok' }, pending: { t: 'Checking', c: 'wait' }, invited: { t: 'Invited', c: 'host' }, waitlisted: { t: 'Waitlist', c: 'off' }, cancelled: { t: 'Cancelled', c: 'off' } };

// One of the host's sessions: post and share it, approve players, invite regulars, see who paid,
// add the court booking receipt, run the courts on the night, or cancel (everyone is refunded).
export default function HostSession() {
  const toast = useToast();
  const [id, setId] = useState<string | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [s, setS] = useState<HostSess | null | undefined>(undefined);
  const [roster, setRoster] = useState<{ rows: RosterRow[]; paid_total: number } | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [sheet, setSheet] = useState<null | 'share' | 'invite' | 'cancel' | 'proof'>(null);
  const [post, setPost] = useState('');
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setId(new URLSearchParams(location.search).get('id')); }, []);
  const load = useCallback(async () => {
    if (!id) return;
    const orgs = await loadHost().catch(() => [] as Org[]);
    const o = orgs.find((x) => x.sessions.some((y) => y.id === id)) ?? null;
    setOrg(o); setS(o?.sessions.find((y) => y.id === id) ?? null);
    rpc<{ rows: RosterRow[]; paid_total: number }>('host_roster', { p_id: id }).then(setRoster).catch(() => setRoster({ rows: [], paid_total: 0 }));
    rpc<Req[]>('host_requests', { p_id: id }).then(setReqs).catch(() => setReqs([]));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const text = useCallback(() => s && org ? announcement({ ...s, varsity_reg_opens_at: null, public_reg_opens_at: null, requires_approval: s.screening, session_type: 'open_play' }, { hostedBy: org.name }) : '', [s, org]);
  useEffect(() => { if (s && new URLSearchParams(location.search).get('new') === '1') history.replaceState(null, '', '/host/session/?id=' + s.id); }, [s]);

  if (s === undefined) return <Loading />;
  if (!s || !org) return <Empty title="This isn't one of your sessions"><Link className="link" href="/host/">Back to Host</Link></Empty>;
  const today = manilaToday();
  const live = !s.cancelled && s.session_date >= today;
  const tonight = !s.cancelled && (s.session_date === today || s.session_date === new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }));

  async function act(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    try { await rpc(fn, args); toast(ok); setSheet(null); await load(); } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  async function openInvite() { setSheet('invite'); setPick(new Set()); setCands(null); rpc<Cand[]>('host_invite_candidates', { p_id: s!.id }).then(setCands).catch(() => setCands([])); }
  async function uploadProof() {
    if (!files?.length) { toast('Choose the court booking receipt first.', true); return; }
    if (files.length > 6) { toast('Up to 6 files.', true); return; }
    setBusy(true);
    try {
      const stamp = Date.now();
      const paths = await Promise.all(Array.from(files).map(async (f, i) => {
        if (f.size > 5 * 1024 * 1024) throw new Error(`${f.name} is over 5 MB`);
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
        const path = `${org!.id}/${s!.id}/${stamp}-${i + 1}.${ext}`;
        const { error } = await sb().storage.from('venue-proofs').upload(path, f, { upsert: true, contentType: f.type || undefined });
        if (error) throw error;
        return path;
      }));
      await rpc('host_session_set_proofs', { p_id: s!.id, p_paths: paths });
      toast('Court proof added. Players can see the court is booked.'); setSheet(null); setFiles(null); await load();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  const rows = (roster?.rows ?? []).filter((r) => r.status !== 'cancelled');
  return (
    <>
      <Band back={{ href: '/host/', label: org.name }}>
        <h1 className="h2" style={{ color: '#fff', marginTop: 4 }}>{s.label}</h1>
        <p className="sub">{fmtDate(s.session_date)}, {fmtClock(s.time_start)} to {fmtClock(s.time_end)}, {s.venue}, {peso(s.fee)}</p>
        <div className="tags" style={{ marginTop: 8 }}>
          {s.cancelled ? <span className="tag off">Cancelled</span> : s.published ? <span className="tag ok">Posted</span> : <span className="tag off">Draft</span>}
          <span className="tag">{s.seats}/{s.max_players} booked</span>
        </div>
        {live && <div className="act-grid" style={{ marginTop: 14 }}>
          {!s.published
            ? <button className="btn pink" disabled={busy} onClick={() => act('host_session_publish', { p_id: s.id }, 'Posted. Now share the link.').then(() => { setPost(text()); setSheet('share'); })}>Post it</button>
            : <button className="btn sm dim" onClick={() => { setPost(text()); setSheet('share'); }}><Icon name="share" />Share</button>}
          <Link className="btn sm dim" href={'/host/edit/?id=' + s.id}>Edit</Link>
          {s.published && <button className="btn sm dim" onClick={openInvite}><Icon name="users" />Invite</button>}
          {tonight && <Link className="btn sm dim" href={'/courts/?s=' + s.id}><Icon name="court" />Run the courts</Link>}
        </div>}
      </Band>

      {live && (
        <div className="section stack">
          <label className={'check' + (s.screening ? ' on' : '')}>
            <input type="checkbox" checked={s.screening} disabled={busy} onChange={(e) => act('host_session_set_screening', { p_id: s.id, p_on: e.target.checked }, e.target.checked ? 'Players now ask to join first' : 'Anyone can book now')} />
            <span><b>I approve players first</b><br /><span className="small muted">Players tap Ask to join. You see their DUPR and games, then they pay once you say yes.</span></span>
          </label>
          <button className="card between" style={{ textAlign: 'left', width: '100%' }} onClick={() => setSheet('proof')}>
            <span><b>Court booking receipt</b><br /><span className="small muted">{s.proof ? 'Added. Players can see the court is booked.' : 'Add the venue receipt so players know the court is real.'}</span></span>
            <span className={'tag ' + (s.proof ? 'ok' : 'off')}>{s.proof ? 'Added' : 'Missing'}</span>
          </button>
        </div>
      )}

      {reqs.length > 0 && (
        <div className="section">
          <div className="section-head"><span className="h3">Want to join ({reqs.length})</span></div>
          <div className="stack">{reqs.map((r) => (
            <div key={r.id} className="card stack">
              <div className="between"><b>{r.name}</b><span className="small muted">DUPR {rating(r.dupr_d)}</span></div>
              <div className="small muted">{r.host_games} game{r.host_games === 1 ? '' : 's'} with you, {r.mdp_games} at MDP{r.note ? `. “${r.note}”` : ''}</div>
              <div className="btn-row"><button className="btn sm green" disabled={busy} onClick={() => act('host_review_request', { p_id: r.id, p_approve: true }, `${r.name} can pay and join now`)}>Let them in</button><button className="btn sm ghost" disabled={busy} onClick={() => act('host_review_request', { p_id: r.id, p_approve: false }, 'Declined')}>Not this time</button></div>
            </div>
          ))}</div>
        </div>
      )}

      <div className="section">
        <div className="section-head"><span className="h3">Players</span><span className="sub">{roster ? `${peso(roster.paid_total)} paid` : ''}</span></div>
        {!roster ? <Loading rows={2} /> : rows.length === 0 ? <div className="card sub">Nobody yet. Share the link on Reclub or Viber.</div> : (
          <div className="list">{rows.map((r, i) => (
            <div key={i}><span className="grow"><b>{r.name}</b>{r.guest ? <span className="small muted"> + {r.guest}</span> : null}<br />
              <span className="small muted">{r.status === 'paid' ? (r.wallet > 0 && r.gcash > 0 ? `${peso(r.wallet)} wallet, ${peso(r.gcash)} GCash` : r.wallet > 0 ? 'Paid from wallet' : 'Paid by GCash') : r.review ? 'Receipt with MDP for review' : r.checking ? 'Receipt being checked' : r.status === 'invited' ? 'Invited, not paid yet' : r.status === 'pending' ? 'Hasn\'t paid yet' : ''}</span></span>
              <span className={'tag ' + (ST[r.status]?.c ?? '')}>{ST[r.status]?.t ?? r.status}</span></div>
          ))}</div>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>Receipts are checked automatically; anything unclear is checked by MDP. Paid money is sent to you after the session.</p>
      </div>

      {live && <div className="section"><button className="link small" onClick={() => setSheet('cancel')}>Cancel this session</button></div>}

      {sheet === 'share' && (
        <Sheet title="Post on Reclub or Viber" onClose={() => setSheet(null)}>
          <textarea className="input" rows={12} value={post} onChange={(e) => setPost(e.target.value)} />
          <button className="btn pink" style={{ marginTop: 12 }} onClick={async () => { const r = await shareText(post, s.label); toast(r === 'copied' ? 'Copied. Paste it in Reclub or Viber.' : r === 'shared' ? 'Shared' : 'Select the text and copy it', r === 'failed'); }}>Copy</button>
        </Sheet>
      )}
      {sheet === 'invite' && (
        <Sheet title="Invite your players" onClose={() => setSheet(null)}>
          <p className="small muted" style={{ marginBottom: 10 }}>Players who&apos;ve booked your sessions before. They get a notification and a held spot to pay for.</p>
          {!cands ? <Loading rows={2} /> : cands.length === 0 ? <p className="sub">No players yet. Everyone who books your sessions shows up here.</p> : (
            <div className="list" style={{ maxHeight: 360, overflow: 'auto' }}>{cands.map((c) => {
              const off = c.in || c.invited;
              return (
                <label key={c.user_id} style={{ opacity: off ? 0.55 : 1 }}>
                  <input type="checkbox" disabled={off} checked={pick.has(c.user_id)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(c.user_id); else n.delete(c.user_id); setPick(n); }} style={{ width: 18, height: 18 }} />
                  <span className="grow"><b>{c.name}</b><br /><span className="small muted">{c.games} game{c.games === 1 ? '' : 's'} with you{c.last ? `, last ${fmtDate(c.last)}` : ''}</span></span>
                  {c.in ? <span className="tag ok">Booked</span> : c.invited ? <span className="tag host">Invited</span> : null}
                </label>
              );
            })}</div>
          )}
          <button className="btn pink" style={{ marginTop: 12 }} disabled={busy || pick.size === 0} onClick={() => act('host_invite', { p_id: s.id, p_users: Array.from(pick) }, `Invited ${pick.size}`)}>{pick.size ? `Send ${pick.size} invite${pick.size === 1 ? '' : 's'}` : 'Pick players'}</button>
        </Sheet>
      )}
      {sheet === 'proof' && (
        <Sheet title="Court booking receipt" onClose={() => setSheet(null)}>
          <p className="small muted" style={{ marginBottom: 10 }}>A screenshot or photo of the venue booking. Up to 6 files, 5 MB each.</p>
          <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles(e.target.files)} />
          <button className="btn pink" style={{ marginTop: 12 }} disabled={busy} onClick={uploadProof}>{busy ? 'Uploading…' : 'Add receipt'}</button>
        </Sheet>
      )}
      {sheet === 'cancel' && (
        <Sheet title="Cancel this session?" onClose={() => setSheet(null)}>
          <p className="sub" style={{ marginBottom: 12 }}>Everyone who paid gets it back in their MDP wallet, and they&apos;re told why.</p>
          <input className="input" placeholder="Reason for the players" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn pink" style={{ marginTop: 12 }} disabled={busy} onClick={() => act('host_session_cancel', { p_id: s.id, p_note: note }, 'Cancelled. Everyone who paid was refunded.')}>Cancel the session</button>
        </Sheet>
      )}
    </>
  );
}
