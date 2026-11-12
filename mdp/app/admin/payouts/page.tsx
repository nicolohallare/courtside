'use client';
import { useCallback, useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { fmtDate, peso } from '@/lib/format';
import type { Payouts } from '@/lib/host';
import { Band, Empty, Loading, Sheet, useToast } from '@/components/Shell';

interface Row { id: string; name: string; fee_per_player: number; members: string[]; summary: Payouts | null }

// Money the club holds for hosts. Whoever sends it (usually Meg) records it here with the GCash
// reference, so the host sees it was paid and the same money can't be sent twice.
export default function AdminPayouts() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pay, setPay] = useState<Row | null>(null);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => rpc<Row[]>('payout_report').then(setRows).catch((e) => { toast((e as Error).message, true); setRows([]); }), [toast]);
  useEffect(() => { load(); }, [load]);
  async function record() {
    if (!pay) return;
    setBusy(true);
    try { const r = await rpc<{ amount: number }>('payout_record', { p_org: pay.id, p_reference: ref, p_note: note }); toast(`Recorded: ${peso(r.amount)} to ${pay.name}`); setPay(null); setRef(''); setNote(''); load(); }
    catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  if (!rows) return <Loading />;
  return (
    <>
      <Band back={{ href: '/admin/', label: 'Admin' }}>
        <h1 className="h1" style={{ marginTop: 4 }}>Host payouts</h1>
        <p className="sub" style={{ marginTop: 6 }}>Players at hosts&apos; sessions pay the club. After the session, send the host their share and record it here.</p>
      </Band>
      <div className="section stack">
        {rows.length === 0 && <Empty title="No hosts yet" />}
        {rows.map((o) => {
          const s = o.summary;
          return (
            <div key={o.id} className="card stack">
              <div className="between"><div><b>{o.name}</b><div className="small muted">{o.members.join(', ')}</div></div><span className="num" style={{ fontWeight: 800, fontSize: 20 }}>{peso(s?.due_net ?? 0)}</span></div>
              {s && s.due_sessions.length > 0 && <div className="list">{s.due_sessions.map((d) => (
                <div key={d.session_id}><span className="grow">{d.label}<br /><span className="small muted">{fmtDate(d.session_date)}, {d.players} paid player{d.players === 1 ? '' : 's'}{d.fee ? `, less ${peso(d.fee)} fee` : ''}</span></span><span className="num">{peso(d.net)}</span></div>
              ))}</div>}
              {s && s.held_gross > 0 && <p className="small muted">{peso(s.held_gross)} more from sessions not played yet.</p>}
              {(s?.due_net ?? 0) > 0 ? <button className="btn pink" onClick={() => setPay(o)}>I sent {peso(s!.due_net)} to {o.name}</button> : <p className="small muted">Nothing to send right now.</p>}
              {s && s.history.length > 0 && (
                <div className="stack small">
                  <b>Sent before</b>
                  {s.history.slice(0, 5).map((h) => <div key={h.id} className="between"><span>{fmtDate(h.sent_at.slice(0, 10))}, ref {h.reference}{h.note ? `, ${h.note}` : ''}</span><span className="num">{peso(h.amount)}</span></div>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {pay && (
        <Sheet title={`Record payment to ${pay.name}`} onClose={() => setPay(null)}>
          <p className="sub" style={{ marginBottom: 12 }}>Send {peso(pay.summary?.due_net ?? 0)} first, then record it. {pay.name} sees it in their Host screen.</p>
          <label className="field"><span>GCash or bank reference</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="13-digit GCash reference" /></label>
          <label className="field"><span>Note (optional)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid in cash at Vantage" /></label>
          <button className="btn pink" disabled={busy || ref.trim().length < 3} onClick={record}>{busy ? 'Saving…' : 'Record payment'}</button>
        </Sheet>
      )}
    </>
  );
}
