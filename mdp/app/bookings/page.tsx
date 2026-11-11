'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { mdpApi, rpc } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { manilaToday, peso } from '@/lib/format';
import { loadMyRegs, type Reg } from '@/lib/sessions';
import { GcashPay } from '@/components/GcashPay';
import { Band, Empty, Loading, Sheet, useToast } from '@/components/Shell';
import { Ticket } from '@/components/Ticket';

const owed = (r: Reg) => Math.max(0, Number(r.amount || 0) - Number(r.credit_applied || 0) - Number(r.gcash_paid || 0));
interface Move { at: string; amount: number; reason: string | null; balance_after: number }

export default function Bookings() {
  const toast = useToast();
  const { userId, ready, wallet, profile, reload } = useMe();
  const [regs, setRegs] = useState<Reg[] | null>(null);
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [paying, setPaying] = useState<Reg | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<Reg | null>(null);
  const [tab, setTab] = useState<'next' | 'past'>('next');
  const load = useCallback(() => {
    loadMyRegs().then(setRegs).catch(() => setRegs([]));
    rpc<Move[]>('my_wallet_history').then(setMoves).catch(() => setMoves([]));
  }, []);
  useEffect(() => { if (userId) load(); }, [userId, load]);

  if (!ready) return <Loading />;
  if (!userId) return <><Band><h1 className="h1" style={{ marginTop: 10 }}>Bookings</h1></Band><Empty title="Sign in to see your bookings"><Link className="link" href="/login/?next=/bookings/">Sign in</Link></Empty></>;

  const today = manilaToday();
  const list = (regs ?? []).filter((r) => r.sessions && !r.paid_by_reg_id);
  const upcoming = list.filter((r) => r.sessions!.session_date >= today && !['cancelled', 'rejected'].includes(r.status) && !r.sessions!.is_cancelled)
    .sort((a, b) => a.sessions!.session_date.localeCompare(b.sessions!.session_date));
  const past = list.filter((r) => !upcoming.includes(r));
  const toPay = upcoming.filter((r) => (r.status === 'invited' || (r.status === 'pending' && !r.proof_url)) && owed(r) > 0);

  async function payWallet(r: Reg) {
    setBusy(true);
    try {
      await mdpApi('confirm-invited-reg', '', { method: 'POST', body: { reg_id: r.id, payment_method: 'wallet' } });
      toast('Paid from your wallet. You\'re in.'); load(); reload();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  async function cancel(r: Reg, scope: 'self' | 'guest' | 'both') {
    setBusy(true);
    try {
      if (r.status === 'invited') { await mdpApi('decline-invited-reg', '', { method: 'POST', body: { reg_id: r.id, note: null } }); toast('Invite declined. The spot is free for someone else.'); }
      else {
        const res = await mdpApi<{ refunded?: number; promoted_count?: number }>('member-cancel-reg', '', { method: 'POST', body: { reg_id: r.id, scope } });
        toast(`Cancelled. ${peso(res.refunded ?? 0)} back in your wallet.${res.promoted_count ? ' Someone from the waitlist got your spot.' : ''}`);
      }
      setCancelling(null); load(); reload();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  const ticket = (r: Reg) => {
    const due = owed(r);
    const canPay = toPay.includes(r);
    return (
      <Ticket key={r.id} r={r} href={'/s/?id=' + r.session_uuid} extra={<span className="num" style={{ fontWeight: 800 }}>{peso(r.amount)}</span>}>
        {canPay && (
          <div className="btn-row">
            {Number(wallet ?? 0) >= due && r.status === 'invited' && <button className="btn sm green" disabled={busy} onClick={() => payWallet(r)}>Pay {peso(due)} from wallet</button>}
            <button className="btn sm pink" onClick={() => setPaying(r)}>Pay {peso(due)} by GCash</button>
          </div>
        )}
        {upcoming.includes(r) && ['paid', 'pending', 'waitlisted', 'invited'].includes(r.status) && (
          <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setCancelling(r)}>{r.status === 'waitlisted' ? 'Leave the waitlist' : r.status === 'invited' ? 'Decline invite' : 'Cancel booking'}</button>
        )}
      </Ticket>
    );
  };

  return (
    <>
      <Band>
        <h1 className="h1" style={{ marginTop: 10 }}>Bookings</h1>
        <p className="sub" style={{ marginTop: 6 }}>{toPay.length ? `${toPay.length} booking${toPay.length === 1 ? '' : 's'} waiting for payment.` : 'Every peso you pay ends up as a booking or comes back to your wallet.'}</p>
        <div className="seg" style={{ marginTop: 16 }} role="tablist">
          <button role="tab" aria-selected={tab === 'next'} className={tab === 'next' ? 'on' : ''} onClick={() => setTab('next')}>Upcoming ({upcoming.length})</button>
          <button role="tab" aria-selected={tab === 'past'} className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>Past and cancelled</button>
        </div>
      </Band>

      <div className="section stack">
        {!regs ? <Loading rows={2} />
          : tab === 'next'
            ? (upcoming.length ? upcoming.map(ticket) : <Empty title="No upcoming games"><Link className="link" href="/">Find a session</Link></Empty>)
            : (past.length ? past.slice(0, 20).map(ticket) : <Empty title="Nothing here yet" />)}
      </div>

      <div className="section" id="wallet">
        <div className="section-head"><span className="h3">MDP wallet</span><span className="num" style={{ fontWeight: 800, fontSize: 22, color: 'var(--court)' }}>{wallet === null ? '—' : peso(wallet)}</span></div>
        <p className="sub" style={{ marginBottom: 10 }}>Refunds land here and are used first when you book.</p>
        <Link className="btn sm pink" href="/topup/" style={{ marginBottom: 12 }}>Top up</Link>
        {!moves ? <Loading rows={1} /> : moves.length === 0 ? <div className="card sub">No wallet activity yet.</div> : (
          <div className="list">
            {moves.slice(0, 12).map((m, i) => (
              <div key={i}>
                <div className="grow"><div style={{ fontWeight: 600 }}>{m.reason || (m.amount > 0 ? 'Credit' : 'Used for a booking')}</div>
                  <div className="small muted">{new Date(m.at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })}</div></div>
                <span className="num" style={{ fontWeight: 800, color: m.amount > 0 ? 'var(--court)' : 'var(--text)' }}>{m.amount > 0 ? '+' : '−'}{peso(Math.abs(m.amount))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {cancelling && cancelling.sessions && (
        <Sheet title={cancelling.status === 'waitlisted' ? 'Leave the waitlist?' : cancelling.status === 'invited' ? 'Decline this invite?' : 'Cancel this booking?'} onClose={() => setCancelling(null)}>
          <p className="sub" style={{ marginBottom: 12 }}>{cancelling.sessions.label}. {cancelling.status === 'invited' ? 'The host will see that you can\'t make it.' : 'What you paid goes back to your MDP wallet, following the club\'s cancellation rules.'}</p>
          <div className="stack">
            {cancelling.guest_name && cancelling.status !== 'waitlisted' && cancelling.status !== 'invited' ? (<>
              <button className="btn ghost" disabled={busy} onClick={() => cancel(cancelling, 'guest')}>Cancel only my guest, {cancelling.guest_name}</button>
              <button className="btn ghost" disabled={busy} onClick={() => cancel(cancelling, 'self')}>Cancel only me (my guest still plays)</button>
              <button className="btn pink" disabled={busy} onClick={() => cancel(cancelling, 'both')}>Cancel both</button>
            </>) : <button className="btn pink" disabled={busy} onClick={() => cancel(cancelling, cancelling.status === 'waitlisted' ? 'self' : 'both')}>{busy ? 'One moment…' : 'Yes, cancel'}</button>}
            <button className="btn ghost" onClick={() => setCancelling(null)}>Keep it</button>
          </div>
        </Sheet>
      )}
      {paying && paying.sessions && (
        <Sheet title={`Pay ${peso(owed(paying))} by GCash`} onClose={() => setPaying(null)}>
          <GcashPay amount={owed(paying)} name={profile?.full_name ?? ''} number={paying.sessions.gcash_number} acct={paying.sessions.gcash_name}
            uploadQuery={'reg_id=' + paying.id} busy={false}
            onSubmit={() => { setPaying(null); toast('Receipt sent. It\'s checked automatically, usually within a minute.'); load(); }} />
        </Sheet>
      )}
    </>
  );
}
