'use client';
import { useCallback, useEffect, useState } from 'react';
import { rpc, sb } from '@/lib/supabase';
import { METHOD_LABEL, PAYMENT_STATUS, fmtDateTime, peso } from '@/lib/format';
import { Loading, useToast } from '@/components/ui';
import type { AdminProps } from './Overview';

interface Pay { id: string; full_name: string; purpose: string; label: string | null; amount: number; method: string; status: string;
  gateway_ref: string | null; gateway_fee: number | null; proof_path: string | null; reported_reference: string | null; receipt_ref_norm: string | null;
  ai_verdict: string | null; ai_notes: string | null; review_note: string | null; reviewed_by_name: string | null; paid_at: string | null; created_at: string; is_test: boolean }

export default function Payments({ club, onChange }: AdminProps) {
  const [filter, setFilter] = useState<'review' | 'all'>('review');
  const [rows, setRows] = useState<Pay[] | null>(null);
  const load = useCallback(async () => {
    setRows(await rpc<Pay[]>('club_payments', { p_club: club.id, p_status: filter === 'review' ? 'review' : null, p_limit: 200 }));
  }, [club.id, filter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={'btn sm' + (filter === 'review' ? ' court' : '')} onClick={() => setFilter('review')}>To review</button>
        <button className={'btn sm' + (filter === 'all' ? ' court' : '')} onClick={() => setFilter('all')}>All payments</button>
      </div>
      {!rows ? <Loading /> : rows.length === 0 ? (
        <div className="panel"><p className="muted">{filter === 'review' ? 'Nothing to review. Receipts that pass every check are approved automatically.' : 'No payments yet.'}</p></div>
      ) : filter === 'review' ? (
        rows.map((p) => <ReviewCard key={p.id} p={p} onDone={() => { load(); onChange(); }} />)
      ) : (
        <div className="panel grid-wrap">
          <table className="t">
            <thead><tr><th>When</th><th>Player</th><th>For</th><th>How</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="small">{fmtDateTime(p.paid_at ?? p.created_at)}</td>
                  <td>{p.full_name}</td>
                  <td className="small">{p.label}</td>
                  <td className="small">{METHOD_LABEL[p.method]}{p.receipt_ref_norm ? <div className="muted">Ref {p.receipt_ref_norm}</div> : p.gateway_ref ? <div className="muted">{p.gateway_ref}</div> : null}</td>
                  <td><span className={'tag ' + (p.status === 'approved' ? 'ok' : p.status === 'rejected' ? 'bad' : 'hold')}>{PAYMENT_STATUS[p.status]}</span>
                    {p.reviewed_by_name && <div className="small muted">by {p.reviewed_by_name}</div>}{p.is_test && <div className="small muted">test</div>}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{peso(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReviewCard({ p, onDone }: { p: Pay; onDone: () => void }) {
  const toast = useToast();
  const [img, setImg] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [ref, setRef] = useState(p.reported_reference ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (p.proof_path) sb().storage.from('receipts').createSignedUrl(p.proof_path, 600).then(({ data }) => setImg(data?.signedUrl ?? null));
  }, [p.proof_path]);

  async function decide(approve: boolean) {
    if (note.trim().length < 3) { toast('Add a short note about what you checked', true); return; }
    setBusy(true);
    try {
      await rpc('review_payment', { p_payment: p.id, p_approve: approve, p_note: note, p_reference: ref || null });
      toast(approve ? 'Approved. The player is confirmed.' : 'Not accepted. The player can try again.'); onDone();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  return (
    <div className="panel">
      <div className="row between"><h3>{p.full_name}</h3><span className="amount" style={{ fontSize: '2rem' }}>{peso(p.amount)}</span></div>
      <p className="small muted">{p.label} · sent {fmtDateTime(p.created_at)}</p>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {img ? <a href={img} target="_blank" rel="noreferrer"><img className="receipt-img" src={img} alt={`Receipt from ${p.full_name}`} /></a> : p.proof_path ? <Loading /> : <p>No screenshot (instant pay held for amount mismatch)</p>}
        <div className="grow" style={{ minWidth: 240 }}>
          {p.ai_notes && <pre className="notes">{p.ai_notes}</pre>}
          {p.review_note && <pre className="notes">{p.review_note}</pre>}
          <p className="small">Before approving, open your GCash and confirm this amount arrived from this player.</p>
          {p.method === 'gcash_receipt' && (
            <label className="field"><span>Reference number</span><input type="text" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
          )}
          <label className="field"><span>Your note (saved in the activity log)</span><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Seen in GCash history" /></label>
          {p.method === 'gcash_receipt' ? (
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => decide(true)}>Approve payment</button>
              <button className="btn danger" disabled={busy} onClick={() => decide(false)}>Not received</button>
            </div>
          ) : <p className="small muted">Instant pay amount mismatches are settled with TechPay. Contact the platform team.</p>}
        </div>
      </div>
    </div>
  );
}
