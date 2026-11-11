'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AdminBand, AdminOnly, RegTag } from '@/components/AdminBits';
import { Empty, Loading, Sheet, useToast } from '@/components/Shell';
import { Icon } from '@/components/Icon';
import { fmtClock, fmtDate, manilaToday, peso, rating } from '@/lib/format';
import { mdpApi } from '@/lib/supabase';
import { announcement, shareText } from '@/lib/announce';
import { isDraft, loadAdminSessions, loadCounts, needsWhy, nextSameWeekday, setPayment, type AdminSess, type Counts, type Player } from '@/lib/admin';

export default function AdminSession() {
  return <AdminOnly><Inner /></AdminOnly>;
}

interface Member { id: string; full_name: string; dupr_doubles: number | null }

function Inner() {
  const toast = useToast();
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [s, setS] = useState<AdminSess | null | undefined>(undefined);
  const [c, setC] = useState<Counts | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | { k: 'player'; p: Player } | { k: 'add' } | { k: 'cancel' } | { k: 'remove'; p: Player } | { k: 'reject'; p: Player } | { k: 'share' }>(null);
  const [post, setPost] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Member[]>([]);

  useEffect(() => { setId(new URLSearchParams(location.search).get('id')); }, []);
  // Right after a session is created, offer the announcement straight away.
  useEffect(() => {
    if (s && new URLSearchParams(location.search).get('new') === '1' && !sheet) { setPost(announcement(s)); setSheet({ k: 'share' }); history.replaceState(null, '', '/admin/session/?id=' + s.id); }
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    if (!id) return;
    const [list, counts] = await Promise.all([loadAdminSessions(), loadCounts()]);
    setS(list.find((x) => x.id === id) ?? null);
    setC(counts[id] ?? { total: 0, paid: 0, pending: 0, waitlisted: 0, players: [] });
  }, [id]);
  useEffect(() => { load().catch((e) => { toast((e as Error).message, true); setS(null); }); }, [load, toast]);
  useEffect(() => {
    if (sheet?.k !== 'add' || !id) return;
    const t = setTimeout(() => {
      mdpApi<Member[]>('members-search', `search=${encodeURIComponent(q)}&exclude_session=${id}&include_self=true`).then(setFound).catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, sheet, id]);

  async function act(f: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await f(); toast(ok); setSheet(null); setNote(''); await load(); } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  if (s === undefined || !c) return <><AdminBand title="Session" back={{ href: '/admin/sessions/', label: 'Sessions' }} /><Loading /></>;
  if (s === null) return <Empty title="Session not found"><Link className="link" href="/admin/sessions/">Back to sessions</Link></Empty>;

  const today = manilaToday();
  const groups: [string, Player[]][] = [
    ['Payment to check', c.players.filter((p) => p.status === 'pending' && (p.proof_url || p.gcash_ref) && !p.paid_by_reg_id)],
    ['Not paid yet', c.players.filter((p) => p.status === 'invited' || (p.status === 'pending' && !p.proof_url && !p.gcash_ref && !p.paid_by_reg_id) || (p.status === 'pending' && p.paid_by_reg_id))],
    ['Paid', c.players.filter((p) => p.status === 'paid')],
    ['Waitlist', c.players.filter((p) => p.status === 'waitlisted').sort((a, b) => (a.waitlist_position ?? 99) - (b.waitlist_position ?? 99))],
  ];
  const name = (p: Player) => p.player_name + (p.guest_name ? ` + ${p.guest_name}` : '');
  const sp = sheet && 'p' in sheet ? sheet.p : null;
  const coveredBy = (p: Player) => (p.paid_by_reg_id ? c.players.find((x) => x.id === p.paid_by_reg_id)?.player_name : null);

  return (
    <>
      <AdminBand title={s.label} back={{ href: '/admin/sessions/', label: 'Sessions' }}
        sub={<>{fmtDate(s.session_date)}, {fmtClock(s.time_start)} to {fmtClock(s.time_end)}<br />{s.venue}</>}>
        <div className="facts">
          <div><div className="k">Booked</div><div className="v">{c.total}<small>/{s.max_players}</small></div></div>
          <div><div className="k">Paid</div><div className="v">{c.paid}</div></div>
          <div><div className="k">{c.waitlisted ? 'Waitlist' : 'Fee'}</div><div className="v">{c.waitlisted ? c.waitlisted : peso(s.fee)}</div></div>
        </div>
        {s.is_cancelled && <div className="note" style={{ marginTop: 14, color: 'var(--text)' }}>Cancelled{s.cancellation_note ? `: ${s.cancellation_note}` : ''}. Paid players got wallet credit.</div>}
        {isDraft(s) && (
          <>
            <p className="sub" style={{ marginTop: 14 }}>Draft. Members can&apos;t see it until you publish.</p>
            <button className="btn pink" style={{ marginTop: 10 }} disabled={busy} onClick={() => act(() => mdpApi('publish-session', '', { method: 'POST', body: { session_id: s.id } }), 'Published. Members can book when registration opens.')}>Publish</button>
          </>
        )}
        {!s.is_cancelled && (
          <div className="act-grid">
            {s.session_date === today && <Link className="btn sm pink" href={'/courts/?s=' + s.id}><Icon name="court" />Run the courts</Link>}
            <button className="btn sm dim" onClick={() => { setPost(announcement(s)); setSheet({ k: 'share' }); }}><Icon name="share" />Share</button>
            <Link className="btn sm dim" href={'/admin/edit/?id=' + s.id}>Edit</Link>
            <Link className="btn sm dim" href={`/admin/edit/?from=${s.id}&date=${nextSameWeekday(s.session_date)}`}>Repeat next week</Link>
            <button className="btn sm dim" onClick={() => { setQ(''); setSheet({ k: 'add' }); }}><Icon name="plus" />Add player</button>
          </div>
        )}
      </AdminBand>

      {groups.map(([title, ps]) => ps.length > 0 && (
        <div key={title} className="section">
          <div className="section-head"><span className="h3">{title}</span><span className="small muted">{ps.length}</span></div>
          <div className="list">
            {ps.map((p) => (
              <button key={p.id} style={{ width: '100%', textAlign: 'left' }} onClick={() => setSheet({ k: 'player', p })}>
                <span className="grow"><b>{name(p)}</b><br />
                  <span className="small muted">{p.status === 'pending' && (p.proof_url || p.gcash_ref) ? needsWhy(p)
                    : coveredBy(p) ? `Paid with ${coveredBy(p)}'s payment`
                    : p.status === 'paid' ? (Number(p.credit_applied) > 0 && !Number(p.gcash_paid) ? 'Paid from wallet' : Number(p.credit_applied) > 0 ? `${peso(p.credit_applied)} wallet + GCash` : 'GCash') : `${peso(p.amount)} due`}</span>
                </span>
                {p.dupr_doubles ? <span className="rating">{rating(p.dupr_doubles)}</span> : null}
                <RegTag p={p} />
              </button>
            ))}
          </div>
        </div>
      ))}
      {c.players.length === 0 && <div className="section"><div className="card sub">No one has booked yet.</div></div>}

      {!s.is_cancelled && (
        <div className="section">
          <button className="btn ghost" style={{ color: 'var(--pink-d)' }} onClick={() => { setNote(''); setSheet({ k: 'cancel' }); }}>Cancel this session</button>
        </div>
      )}
      <div style={{ height: 24 }} />

      {sheet?.k === 'player' && sp && (
        <Sheet title={name(sp)} onClose={() => setSheet(null)}>
          <div className="row" style={{ marginBottom: 8 }}><RegTag p={sp} />{coveredBy(sp) && <span className="small muted">Paid together with {coveredBy(sp)}</span>}</div>
          <dl className="kv">
            <dt>Amount</dt><dd>{peso(sp.amount)}</dd>
            {Number(sp.credit_applied) > 0 && <><dt>From wallet</dt><dd>{peso(sp.credit_applied)}</dd></>}
            {Number(sp.gcash_paid) > 0 && <><dt>By GCash</dt><dd>{peso(sp.gcash_paid)}</dd></>}
            {sp.gcash_ref && <><dt>GCash ref</dt><dd>{sp.gcash_ref}</dd></>}
          </dl>
          {sp.ai_check_notes && <div className="note" style={{ marginTop: 12, fontSize: 13 }}>{sp.ai_check_notes.split('\n\n')[0]}</div>}
          {sp.proof_url && <a href={sp.proof_url} target="_blank" rel="noopener" className="link" style={{ display: 'inline-block', marginTop: 10 }}>Open the receipt</a>}
          <div className="stack" style={{ marginTop: 16 }}>
            {sp.status === 'pending' && (sp.proof_url || sp.gcash_ref) && !sp.paid_by_reg_id && (
              <div className="btn-row">
                <button className="btn ghost" disabled={busy} onClick={() => { setNote(''); setSheet({ k: 'reject', p: sp }); }}>Reject</button>
                <button className="btn green" disabled={busy} onClick={() => {
                  if (sp.ai_check_status === 'flagged' && !window.confirm('The receipt check flagged this payment. Approve only if you can see the money in GCash.')) return;
                  act(() => setPayment(sp, c.players, 'paid'), 'Confirmed');
                }}>Approve</button>
              </div>
            )}
            {(sp.status === 'invited' || (sp.status === 'pending' && !sp.proof_url && !sp.gcash_ref && !sp.paid_by_reg_id)) && (
              <>
                <button className="btn navy" disabled={busy} onClick={() => act(() => mdpApi('remind-payment', '', { method: 'POST', body: { reg_id: sp.id } }), 'Reminder sent')}>Remind to pay</button>
                <button className="btn ghost" disabled={busy} onClick={() => {
                  if (!window.confirm(`Mark ${sp.player_name} as paid? Only do this if they paid cash or you can see their GCash.`)) return;
                  act(() => setPayment(sp, c.players, 'paid'), 'Marked as paid');
                }}>Paid in cash or GCash I can see</button>
              </>
            )}
            {['paid', 'pending', 'invited', 'waitlisted'].includes(sp.status) && <button className="btn ghost" style={{ color: 'var(--pink-d)' }} disabled={busy} onClick={() => { setNote(''); setSheet({ k: 'remove', p: sp }); }}>Remove from session</button>}
          </div>
        </Sheet>
      )}

      {sheet?.k === 'reject' && (
        <Sheet title="Reject payment" onClose={() => setSheet(null)}>
          <p className="sub" style={{ marginBottom: 12 }}>{sheet.p.player_name} gets a notification with your reason and can upload a new receipt.</p>
          <label className="field"><span>Reason</span><input className="input" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Amount doesn't match" /></label>
          <button className="btn pink" disabled={busy || !note.trim()} onClick={() => act(() => setPayment(sheet.p, c.players, 'rejected', note.trim()), 'Rejected. They\'ve been told why.')}>Reject and tell them</button>
        </Sheet>
      )}

      {sheet?.k === 'remove' && (
        <Sheet title={`Remove ${sheet.p.player_name}?`} onClose={() => setSheet(null)}>
          <p className="sub" style={{ marginBottom: 12 }}>Anything they paid, from GCash or their wallet, goes back to their wallet.{c.players.some((k) => k.paid_by_reg_id === sheet.p.id && !['cancelled', 'rejected'].includes(k.status)) ? ` The players they paid for (${c.players.filter((k) => k.paid_by_reg_id === sheet.p.id && !['cancelled', 'rejected'].includes(k.status)).map((k) => k.player_name).join(', ')}) are removed too.` : ''}</p>
          <label className="field"><span>Note (optional)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Asked to cancel by message" /></label>
          <button className="btn pink" disabled={busy} onClick={() => act(() => mdpApi('admin-cancel-registration', '', { method: 'POST', body: { reg_id: sheet.p.id, note: note.trim() } }), `${sheet.p.player_name.split(' ')[0]} removed`)}>Remove and refund to wallet</button>
        </Sheet>
      )}

      {sheet?.k === 'add' && (
        <Sheet title="Add a player" onClose={() => setSheet(null)}>
          <p className="sub" style={{ marginBottom: 12 }}>They get a notification to confirm and pay, from their wallet or GCash.</p>
          <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members by name" />
          <div className="list" style={{ marginTop: 12, maxHeight: '45vh', overflow: 'auto' }}>
            {found.slice(0, 30).map((m) => (
              <button key={m.id} style={{ width: '100%', textAlign: 'left' }} disabled={busy}
                onClick={() => act(() => mdpApi('admin-register-for-member', '', { method: 'POST', body: { session_id: s.id, member_ids: [m.id] } }), `${m.full_name} invited`)}>
                <span className="grow">{m.full_name}</span>{m.dupr_doubles ? <span className="rating">{rating(m.dupr_doubles)}</span> : null}<Icon name="plus" />
              </button>
            ))}
            {found.length === 0 && <div className="small muted">{q ? 'No member by that name.' : 'Type a name.'}</div>}
          </div>
        </Sheet>
      )}

      {sheet?.k === 'share' && (
        <Sheet title="Post this session" onClose={() => setSheet(null)}>
          <p className="sub" style={{ marginBottom: 10 }}>{isDraft(s) ? 'Publish first, so the link works for members. ' : ''}Copy this into Reclub or your Viber group. You can edit it here first; the link takes players straight to booking.</p>
          <textarea className="input" rows={14} value={post} onChange={(e) => setPost(e.target.value)} style={{ fontSize: 14, lineHeight: 1.45 }} />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn pink" onClick={async () => { const r = await shareText(post, s.label); toast(r === 'copied' ? 'Copied. Paste it in Reclub or Viber.' : r === 'shared' ? 'Shared' : 'Select the text and copy it', r === 'failed'); }}>Copy</button>
            {typeof navigator !== 'undefined' && 'share' in navigator && <button className="btn ghost" onClick={() => navigator.share({ title: s.label, text: post }).catch(() => {})}>Share to an app</button>}
          </div>
        </Sheet>
      )}

      {sheet?.k === 'cancel' && (
        <Sheet title="Cancel this session?" onClose={() => setSheet(null)}>
          <p className="sub" style={{ marginBottom: 12 }}>Everyone who paid gets the full amount back as wallet credit. Unpaid bookings and the waitlist are cancelled. Members are notified.</p>
          <label className="field"><span>Reason members will see</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Rain, courts closed" /></label>
          <button className="btn pink" disabled={busy || !note.trim()} onClick={() => act(async () => { await mdpApi('cancel-session', '', { method: 'POST', body: { session_id: s.id, note: note.trim() } }); router.refresh(); }, 'Session cancelled. Wallets credited.')}>Cancel session and credit everyone</button>
        </Sheet>
      )}
    </>
  );
}
