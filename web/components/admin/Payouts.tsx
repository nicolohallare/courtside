'use client';
import { useCallback, useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { fmtDateTime, peso } from '@/lib/format';
import { Loading, useToast } from '@/components/ui';
import type { AdminProps } from './Overview';

interface Line { id: number; kind: string; amount: number; note: string | null; created_at: string; available_at: string; payout_id: string | null; player: string | null }
interface PayoutRow { id: string; amount: number; status: string; reference: string | null; created_at: string; sent_at: string | null }
interface Summary {
  settlement_mode: 'platform' | 'direct';
  available: number; on_hold: number; next_available_at: string | null; paid_out: number;
  account: null | { method: string; bank_name: string | null; account_name: string; last4: string; holder_type: string; verified: boolean };
  payouts: PayoutRow[]; lines: Line[];
}

const KIND: Record<string, string> = {
  collection: 'Payment', reversal: 'Payment reversed', refund: 'Refund to player',
  refund_waived: 'Refund waived', adjustment: 'Adjustment',
};
const METHOD: Record<string, string> = { bank: 'Bank', gcash: 'GCash', maya: 'Maya' };

/** Where the club's money is: collected by the platform, held briefly, then paid out on a schedule. */
export default function Payouts({ club, isAdmin }: AdminProps) {
  const toast = useToast();
  const [s, setS] = useState<Summary | null>(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => setS(await rpc<Summary>('club_payout_summary', { p_club: club.id })), [club.id]);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try {
      await rpc('set_payout_account', {
        p_club: club.id, p_method: f.get('method'), p_bank_name: f.get('bank') || null,
        p_account_name: f.get('name'), p_account_number: f.get('number'), p_holder_type: f.get('holder'),
      });
      toast('Saved. Match Day Pickle checks it before the next payout.'); setEditing(false); load();
    } catch (err) { toast((err as Error).message, true); }
  }

  if (!s) return <Loading />;
  if (s.settlement_mode === 'direct') return (
    <div className="panel"><p>Payments settle straight to your own TechPay account, so there are no payouts here. Your statement is in TechPay’s merchant portal.</p></div>
  );
  const pending = s.payouts.find((p) => p.status === 'pending');

  return (
    <div>
      <div className="stats">
        <div className="stat"><div className="v">{peso(s.available)}</div><div className="k">Ready for the next payout</div></div>
        <div className="stat"><div className="v">{peso(s.on_hold)}</div><div className="k">On hold{s.next_available_at ? ` until ${fmtDateTime(s.next_available_at)}` : ''}</div></div>
        <div className="stat"><div className="v">{peso(s.paid_out)}</div><div className="k">Paid out so far</div></div>
      </div>
      <p className="small muted">
        Players pay through Match Day Pickle’s TechPay account. Each payment is held two days in case it’s disputed, then paid out to you weekly.
        Refunds on those payments are sent to players by Match Day Pickle and taken from your next payout.
      </p>
      {pending && <p className="tag hold">Payout of {peso(pending.amount)} is being sent.</p>}

      <div className="panel">
        <div className="row between"><h2 style={{ margin: 0 }}>Where we send your money</h2>
          {isAdmin && !editing && <button className="btn sm" onClick={() => setEditing(true)}>{s.account ? 'Change' : 'Add account'}</button>}</div>
        {!editing && (s.account ? (
          <p>{METHOD[s.account.method]}{s.account.bank_name ? ` · ${s.account.bank_name}` : ''} · {s.account.account_name} · ending {s.account.last4}{' '}
            <span className={'tag ' + (s.account.verified ? 'ok' : 'hold')}>{s.account.verified ? 'Verified' : 'Waiting for our check'}</span>
            {s.account.holder_type === 'organizer' && <span className="small muted"> · paid to the organizer, not a club account</span>}</p>
        ) : <p className="muted">No payout account yet. Payouts wait until you add one.</p>)}
        {editing && (
          <form onSubmit={save}>
            <div className="row">
              <label className="field"><span>Paid to</span><select name="method" defaultValue={s.account?.method ?? 'bank'}><option value="bank">Bank</option><option value="gcash">GCash</option><option value="maya">Maya</option></select></label>
              <label className="field grow"><span>Bank (if bank)</span><input type="text" name="bank" defaultValue={s.account?.bank_name ?? ''} /></label>
            </div>
            <label className="field"><span>Account name, exactly as the bank or wallet shows it</span><input type="text" name="name" required defaultValue={s.account?.account_name ?? ''} /></label>
            <label className="field"><span>Account or mobile number</span><input type="text" name="number" required inputMode="numeric" /></label>
            <label className="field"><span>Whose account is it?</span><select name="holder" defaultValue={s.account?.holder_type ?? 'club'}>
              <option value="club">The club’s own account</option><option value="organizer">Mine, as the organizer (we’ll check your ID)</option></select></label>
            <p className="small muted">Changing the account pauses payouts until Match Day Pickle checks the new one.</p>
            <button className="btn primary">Save</button>{' '}<button type="button" className="linkbtn" onClick={() => setEditing(false)}>Cancel</button>
          </form>
        )}
      </div>

      {s.payouts.length > 0 && (
        <div className="panel grid-wrap"><h2>Payouts</h2>
          <table className="t"><thead><tr><th>Created</th><th>Status</th><th>Reference</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>{s.payouts.map((p) => (
              <tr key={p.id}><td className="small">{fmtDateTime(p.created_at)}</td>
                <td><span className={'tag ' + (p.status === 'sent' ? 'ok' : p.status === 'failed' ? 'bad' : 'hold')}>{p.status === 'sent' ? 'Sent' : p.status === 'failed' ? 'Failed, will retry' : 'Sending'}</span></td>
                <td className="small">{p.reference ?? '—'}</td><td className="num" style={{ textAlign: 'right' }}>{peso(p.amount)}</td></tr>
            ))}</tbody></table></div>
      )}

      <div className="panel grid-wrap"><h2>Statement</h2>
        {s.lines.length === 0 ? <p className="muted">Nothing yet. Payments made through TechPay show here.</p> : (
          <table className="t"><thead><tr><th>When</th><th>What</th><th>Player</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>{s.lines.map((l) => (
              <tr key={l.id}><td className="small">{fmtDateTime(l.created_at)}</td>
                <td className="small">{KIND[l.kind] ?? l.kind}{l.payout_id ? <span className="muted"> · in a payout</span> : ''}</td>
                <td className="small">{l.player ?? '—'}</td>
                <td className="num" style={{ textAlign: 'right' }}>{Number(l.amount) < 0 ? '−' : ''}{peso(Math.abs(Number(l.amount)))}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </div>
  );
}
