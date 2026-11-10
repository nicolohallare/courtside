'use client';
import { useCallback, useEffect, useState } from 'react';
import { AdminBand, AdminOnly } from '@/components/AdminBits';
import { Loading, Sheet, useToast } from '@/components/Shell';
import { fmtDate, peso } from '@/lib/format';
import { mdpApi, rpc } from '@/lib/supabase';
import { loadAdminSessions, loadCounts, loadOverpaid, loadTopups, needsWhy, setPayment, type AdminSess, type Overpay, type Player, type Topup } from '@/lib/admin';

interface Item { p: Player; s: AdminSess; all: Player[] }

export default function Payments() {
  return <AdminOnly><PaymentsInner /></AdminOnly>;
}

function PaymentsInner() {
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [topups, setTopups] = useState<Topup[]>([]);
  const [over, setOver] = useState<Overpay[]>([]);
  const [busy, setBusy] = useState('');
  const [reject, setReject] = useState<null | { kind: 'reg'; it: Item } | { kind: 'topup'; t: Topup }>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const [sessions, counts, tu, ov] = await Promise.all([loadAdminSessions(), loadCounts(), loadTopups().catch(() => []), loadOverpaid().catch(() => [])]);
    const byId = new Map(sessions.filter((s) => !s.is_cancelled).map((s) => [s.id, s]));
    const list: Item[] = [];
    for (const [sid, c] of Object.entries(counts)) {
      const s = byId.get(sid); if (!s) continue;
      for (const p of c.players) if (p.status === 'pending' && !p.paid_by_reg_id && (p.proof_url || p.gcash_ref)) list.push({ p, s, all: c.players });
    }
    list.sort((a, b) => (a.p.ai_check_status === 'flagged' ? 0 : 1) - (b.p.ai_check_status === 'flagged' ? 0 : 1) || a.s.session_date.localeCompare(b.s.session_date));
    setItems(list); setTopups(tu.filter((t) => t.status === 'pending' && t.proof_url)); setOver(ov);
  }, []);
  useEffect(() => { load().catch((e) => toast((e as Error).message, true)); }, [load, toast]);
  useEffect(() => { if (items && location.hash === '#overpaid') document.getElementById('overpaid')?.scrollIntoView({ behavior: 'smooth' }); }, [items]);

  async function run(key: string, f: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await f(); toast(ok); setReject(null); setNote(''); await load(); } catch (e) { toast((e as Error).message, true); }
    setBusy('');
  }

  if (!items) return <><AdminBand title="Payments" /><Loading /></>;
  const n = items.length + topups.length;

  return (
    <>
      <AdminBand title="Payments" sub={n ? `${n} to check. Approve only when you can see the money in GCash.` : 'Nothing to check. The AI check approved everything else.'} badges={{ Payments: n + over.length }} />

      <div className="section">
        {items.map((it) => {
          const { p, s, all } = it;
          const kids = all.filter((k) => k.paid_by_reg_id === p.id && k.status !== 'cancelled');
          const due = Math.max(0, Number(p.amount) - Number(p.credit_applied ?? 0));
          const flagged = p.ai_check_status === 'flagged';
          return (
            <div key={p.id} className="pay">
              <div className="ph">
                <div className="between"><span className="who">{p.player_name}{p.guest_name ? ` + ${p.guest_name}` : ''}</span><span className="num" style={{ fontWeight: 800, fontSize: 18 }}>{peso(due)}</span></div>
                <div className="small muted">{s.label}, {fmtDate(s.session_date)}{kids.length ? `. Also pays for ${kids.map((k) => k.player_name).join(', ')}` : ''}</div>
                <div className="why">{flagged ? 'Flagged: ' : ''}{needsWhy(p)}</div>
                {p.gcash_ref && <div className="small muted" style={{ marginTop: 6 }}>GCash ref {p.gcash_ref}</div>}
              </div>
              {p.proof_url && <a href={p.proof_url} target="_blank" rel="noopener"><img className="shot" src={p.proof_url} alt={`Receipt from ${p.player_name}`} /></a>}
              <div className="acts">
                <button className="btn ghost" disabled={!!busy} onClick={() => { setNote(''); setReject({ kind: 'reg', it }); }}>Reject</button>
                <button className="btn green" disabled={!!busy} onClick={() => {
                  if (flagged && !window.confirm(`The receipt check flagged this payment.\n\nApprove only if you can see ${peso(due)} from ${p.player_name} in GCash.`)) return;
                  run(p.id, () => setPayment(p, all, 'paid'), `${p.player_name.split(' ')[0]} is confirmed`);
                }}>{busy === p.id ? 'Saving…' : 'Approve'}</button>
              </div>
            </div>
          );
        })}

        {topups.map((t) => (
          <div key={t.id} className="pay">
            <div className="ph">
              <div className="between"><span className="who">{t.profiles?.full_name ?? 'Member'}</span><span className="num" style={{ fontWeight: 800, fontSize: 18 }}>{peso(t.amount)}</span></div>
              <div className="small muted">Wallet top-up by GCash</div>
              {t.ai_check_notes && <div className="why">{t.ai_check_notes.split('\n')[0].replace(/^[^\w₱]*(FLAGGED|APPROVED):\s*/i, '')}</div>}
            </div>
            {t.proof_url && <a href={t.proof_url} target="_blank" rel="noopener"><img className="shot" src={t.proof_url} alt="Top-up receipt" /></a>}
            <div className="acts">
              <button className="btn ghost" disabled={!!busy} onClick={() => { setNote(''); setReject({ kind: 'topup', t }); }}>Reject</button>
              <button className="btn green" disabled={!!busy} onClick={() => run(t.id, () => mdpApi('admin-topup-status', '', { method: 'PATCH', body: { id: t.id, status: 'approved' } }), `${peso(t.amount)} added to the wallet`)}>{busy === t.id ? 'Saving…' : 'Add to wallet'}</button>
            </div>
          </div>
        ))}
      </div>

      {over.length > 0 && (
        <div className="section" id="overpaid">
          <div className="section-head"><span className="h3">Paid too much</span></div>
          <p className="sub" style={{ marginBottom: 10 }}>The receipt shows more than the booking cost. Add the extra to their wallet, or mark it if the extra was for something else.</p>
          {over.map((o) => (
            <div key={o.reg_id} className="pay">
              <div className="ph">
                <div className="between"><span className="who">{o.player_name}</span><span className="num" style={{ fontWeight: 800, fontSize: 18, color: 'var(--court)' }}>+{peso(o.excess)}</span></div>
                <div className="small muted">{o.session_label}, {fmtDate(o.session_date)}</div>
                <div className="why ok">Sent {peso(o.sent)} for {peso(o.owed)} due{o.gcash_ref ? `. GCash ref ${o.gcash_ref}` : ''}</div>
              </div>
              <div className="acts">
                <button className="btn ghost" disabled={!!busy} onClick={() => {
                  const why = window.prompt('Why isn\'t this an overpayment? (for example: paid for a friend outside the app)');
                  if (why === null) return;
                  run(o.reg_id, () => rpc('admin_dismiss_overpay', { p_reg: o.reg_id, p_note: why }), 'Marked. It won\'t show again.');
                }}>Not extra</button>
                <button className="btn green" disabled={!!busy} onClick={() => run(o.reg_id, () => rpc('admin_credit_overpay', { p_reg: o.reg_id }), `${peso(o.excess)} added to ${o.player_name.split(' ')[0]}'s wallet`)}>{busy === o.reg_id ? 'Saving…' : `Add ${peso(o.excess)} to wallet`}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ height: 24 }} />

      {reject && (
        <Sheet title="Reject payment" onClose={() => setReject(null)}>
          <p className="sub" style={{ marginBottom: 12 }}>{reject.kind === 'reg'
            ? `${reject.it.p.player_name} gets a notification with your reason and can upload a new receipt.`
            : 'The member gets a notification with your reason. Nothing is added to the wallet.'}</p>
          <label className="field"><span>Reason</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Amount doesn't match, or wrong GCash number" autoFocus />
          </label>
          <button className="btn pink" disabled={!!busy || !note.trim()} onClick={() => reject.kind === 'reg'
            ? run(reject.it.p.id, () => setPayment(reject.it.p, reject.it.all, 'rejected', note.trim()), 'Rejected. They\'ve been told why.')
            : run(reject.t.id, () => mdpApi('admin-topup-status', '', { method: 'PATCH', body: { id: reject.t.id, status: 'rejected', admin_note: note.trim() } }), 'Top-up rejected')}>
            Reject and tell them
          </button>
        </Sheet>
      )}
    </>
  );
}
