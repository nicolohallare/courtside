'use client';
import { useCallback, useEffect, useState } from 'react';
import { rpc, sb } from '@/lib/supabase';
import { fmtDateTime, peso } from '@/lib/format';
import { Loading, useToast } from '@/components/ui';
import type { AdminProps } from './Overview';

interface Refund { paid_by?: 'club' | 'platform'; id: string; full_name: string; phone: string | null; amount: number; reason: string; status: string; settle_note: string | null; settled_at: string | null; created_at: string }

export default function Refunds({ club, onChange }: AdminProps) {
  const toast = useToast();
  const [status, setStatus] = useState<'owed' | null>('owed');
  const [rows, setRows] = useState<Refund[] | null>(null);
  const load = useCallback(async () => {
    const list = await rpc<Refund[]>('club_refunds', { p_club: club.id, p_status: status });
    // who sends each refund: the platform, when the payment came in through its TechPay account
    const { data } = await sb().from('refunds').select('id, paid_by').eq('club_id', club.id);
    const by = new Map((data ?? []).map((r: { id: string; paid_by: 'club' | 'platform' }) => [r.id, r.paid_by]));
    setRows(list.map((r) => ({ ...r, paid_by: by.get(r.id) ?? 'club' })));
  }, [club.id, status]);
  useEffect(() => { load(); }, [load]);

  async function settle(r: Refund, st: 'paid' | 'waived') {
    const note = prompt(st === 'paid'
      ? `GCash reference of the ${peso(r.amount)} you sent to ${r.full_name}${r.phone ? ` (${r.phone})` : ''}:`
      : 'Why is this refund closed without paying? (e.g. player chose credit for next game)');
    if (!note) return;
    try { await rpc('settle_refund', { p_refund: r.id, p_status: st, p_note: note }); toast(st === 'paid' ? 'Marked as sent. The player sees it in their history.' : 'Closed'); load(); onChange(); }
    catch (e) { toast((e as Error).message, true); }
  }

  const total = (rows ?? []).filter((r) => r.status === 'owed' && r.paid_by !== 'platform').reduce((n, r) => n + Number(r.amount), 0);
  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={'btn sm' + (status ? ' court' : '')} onClick={() => setStatus('owed')}>Owed</button>
        <button className={'btn sm' + (!status ? ' court' : '')} onClick={() => setStatus(null)}>All</button>
        {status && total > 0 && <span className="grow" style={{ textAlign: 'right' }}>Total owed <span className="num">{peso(total)}</span></span>}
      </div>
      <p className="small muted">Refunds are created automatically: early cancellations, cancelled sessions, waitlist places that never opened, and late or double payments. Send each one by GCash, then record the reference here. Refunds marked “Match Day Pickle sends” are paid by us from the TechPay money and taken from your next payout.</p>
      {!rows ? <Loading /> : rows.length === 0 ? <div className="panel"><p className="muted">No refunds owed.</p></div> : (
        <div className="panel grid-wrap">
          <table className="t">
            <thead><tr><th>Player</th><th>Why</th><th>Since</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.full_name}</strong><div className="small muted">{r.phone ?? 'no mobile on file'}</div></td>
                  <td className="small">{r.reason}{r.settle_note && <div className="muted">{r.status === 'paid' ? 'Sent: ' : 'Closed: '}{r.settle_note}</div>}</td>
                  <td className="small">{fmtDateTime(r.created_at)}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{peso(r.amount)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.status === 'owed' && r.paid_by === 'platform' ? (
                    <><span className="tag">Match Day Pickle sends</span>{' '}
                      <button className="linkbtn small" onClick={() => settle(r, 'waived')}>Close</button></>
                  ) : r.status === 'owed' ? (
                    <><button className="btn sm court" onClick={() => settle(r, 'paid')}>Mark sent</button>{' '}
                      <button className="linkbtn small" onClick={() => settle(r, 'waived')}>Close</button></>
                  ) : <span className={'tag ' + (r.status === 'paid' ? 'ok' : '')}>{r.status === 'paid' ? 'Sent' : 'Closed'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
