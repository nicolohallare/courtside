'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { mdpApi } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { fmtClock, fmtDate, manilaToday, peso } from '@/lib/format';
import { loadMyRegs, type Reg } from '@/lib/sessions';
import { GcashPay } from '@/components/GcashPay';
import { Loading, Sheet, useToast } from '@/components/Shell';

const owed = (r: Reg) => Math.max(0, Number(r.amount || 0) - Number(r.credit_applied || 0) - Number(r.gcash_paid || 0));

function status(r: Reg): { cls: string; text: string } {
  if (r.status === 'paid') return { cls: 'paid', text: '✓ Confirmed' };
  if (r.status === 'invited') return { cls: 'inv', text: 'Approved · pay to confirm' };
  if (r.status === 'waitlisted') return { cls: 'pend', text: `On waitlist${r.waitlist_position ? ' #' + r.waitlist_position : ''}` };
  if (r.status === 'cancelled') return { cls: 'off', text: 'Cancelled' };
  if (r.status === 'rejected') return { cls: 'off', text: 'Not accepted' };
  if (r.proof_url && r.ai_check_status === 'flagged') return { cls: 'pend', text: 'Receipt being reviewed by MDP' };
  if (r.proof_url) return { cls: 'pend', text: 'Receipt being checked' };
  return { cls: 'pend', text: 'Waiting for payment' };
}

export default function Slots() {
  const toast = useToast();
  const { userId, ready, wallet, profile, reload } = useMe();
  const [regs, setRegs] = useState<Reg[] | null>(null);
  const [paying, setPaying] = useState<Reg | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { loadMyRegs().then(setRegs).catch(() => setRegs([])); }, []);
  useEffect(() => { if (userId) load(); }, [userId, load]);

  if (!ready) return <Loading />;
  if (!userId) return <div className="empty2"><Link href="/login/" style={{ color: 'var(--pk)', fontWeight: 800 }}>Sign in</Link> to see your slots.</div>;

  const today = manilaToday();
  const list = (regs ?? []).filter((r) => r.sessions && !r.paid_by_reg_id);
  const upcoming = list.filter((r) => r.sessions!.session_date >= today && !['cancelled', 'rejected'].includes(r.status));
  const past = list.filter((r) => !upcoming.includes(r));

  async function payWallet(r: Reg) {
    setBusy(true);
    try {
      await mdpApi('confirm-invited-reg', '', { method: 'POST', body: { reg_id: r.id, payment_method: 'wallet' } });
      toast('✓ Paid from your wallet'); load(); reload();
    } catch (e) { toast('⚠️ ' + (e as Error).message, true); }
    setBusy(false);
  }

  const card = (r: Reg) => {
    const st = status(r), s = r.sessions!, due = owed(r);
    const canPay = (r.status === 'invited' || (r.status === 'pending' && !r.proof_url)) && due > 0;
    return (
      <div key={r.id} className="slot-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div>
            <div className="slot-day">{s.label}</div>
            <div style={{ fontSize: 12, color: 'var(--cd)', marginTop: 3 }}>{fmtDate(s.session_date)} · {fmtClock(s.time_start)}–{fmtClock(s.time_end)} · {s.venue}</div>
            {r.guest_name && <div style={{ fontSize: 12, color: 'var(--pk)', marginTop: 3 }}>+ guest {r.guest_name}</div>}
          </div>
          <span className={'st ' + st.cls}>{st.text}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--cd)', marginTop: 8 }}>
          {peso(r.amount)}{Number(r.credit_applied) > 0 ? ` · ${peso(r.credit_applied)} from wallet` : ''}{due > 0 && r.status !== 'paid' ? ` · ${peso(due)} still to pay` : ''}
        </div>
        {canPay && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {Number(wallet ?? 0) >= due && r.status === 'invited' && <button className="btn btn-g" style={{ flex: 1 }} disabled={busy} onClick={() => payWallet(r)}>Pay {peso(due)} from wallet</button>}
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setPaying(r)}>Pay {peso(due)} by GCash</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '20px 16px 0' }}>
      <div className="inner-ttl">My Slots</div>
      {wallet !== null && <div style={{ fontSize: 13, color: 'var(--cd)', marginBottom: 14 }}>MDP wallet: <b style={{ color: 'var(--gr)' }}>{peso(wallet)}</b></div>}
      {!regs ? <Loading /> : upcoming.length === 0 ? <div className="empty2">No upcoming slots. <Link href="/" style={{ color: 'var(--pk)', fontWeight: 800 }}>Book a session</Link></div> : upcoming.map(card)}
      {past.length > 0 && <><div className="slbl" style={{ display: 'block', margin: '18px 0 10px' }}>Past and cancelled</div>{past.slice(0, 10).map(card)}</>}
      {paying && paying.sessions && (
        <Sheet title="Pay by GCash" onClose={() => setPaying(null)}>
          <GcashPay amount={owed(paying)} name={profile?.full_name ?? ''} number={paying.sessions.gcash_number} acct={paying.sessions.gcash_name}
            uploadQuery={'reg_id=' + paying.id} busy={false}
            onSubmit={() => { setPaying(null); toast('✓ Receipt sent. It\'s checked automatically, usually within a minute.'); load(); }} />
        </Sheet>
      )}
    </div>
  );
}
