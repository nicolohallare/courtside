'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mdpApi } from '@/lib/supabase';
import { useMe, profileProblem } from '@/lib/me';
import { fmtClock, fmtDate, peso } from '@/lib/format';
import { loadSessions, type Sess } from '@/lib/sessions';
import { GcashPay } from '@/components/GcashPay';
import { Loading, useToast } from '@/components/Shell';

type Step = 'details' | 'gcash' | 'done';
interface Result { status: string; id: string }

// Booking goes through the same server as the current app, so tiers, capacity, wallet,
// receipt checks, refunds and host payouts all apply exactly as before.
export default function Book() {
  const router = useRouter();
  const toast = useToast();
  const { userId, ready, profile, wallet } = useMe();
  const [s, setS] = useState<Sess | null | undefined>(undefined);
  const [guest, setGuest] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [step, setStep] = useState<Step>('details');
  const [useWallet, setUseWallet] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('s');
    loadSessions().then((l) => setS(l.find((x) => x.id === id) ?? null)).catch(() => setS(null));
  }, []);
  useEffect(() => { if (ready && !userId) router.replace('/login/'); }, [ready, userId, router]);

  if (s === undefined || !ready) return <Loading />;
  if (s === null) return <div className="empty2">This session isn&apos;t open for booking. <Link href="/" style={{ color: 'var(--pk)' }}>Back to sessions</Link></div>;
  if (s.requires_approval) return <div className="empty2">The host checks players first for this session. <Link href={'/?s=' + s.id} style={{ color: 'var(--pk)', fontWeight: 800 }}>Request to join</Link></div>;

  const name = profile?.full_name ?? '';
  const total = Number(s.fee) * (guest ? 2 : 1);
  const bal = Math.max(0, Number(wallet ?? 0));
  const fromWallet = useWallet ? Math.min(bal, total) : 0;
  const due = total - fromWallet;

  async function book(proofUrl: string | null, ref: string) {
    const problem = profileProblem(profile); if (problem) { toast('⚠️ ' + problem, true); return; }
    if (guest && !guestName.trim()) { toast('Add your guest\'s full name', true); return; }
    setBusy(true);
    try {
      const r = await mdpApi<Result>('register', '', { method: 'POST', body: {
        session_uuid: s!.id, player_name: name, guest_name: guest ? guestName.trim() : null, additional_member_ids: [],
        amount: s!.fee, gcash_ref: ref || null, status: 'pending', proof_url: proofUrl,
        payment_method: fromWallet > 0 ? 'wallet' : 'gcash',
      } });
      setResult(r); setStep('done');
    } catch (e) { toast('⚠️ ' + (e as Error).message, true); }
    setBusy(false);
  }

  if (step === 'gcash') return (
    <>
      <button className="back-btn" onClick={() => setStep('details')}>← Back</button>
      <GcashPay amount={due} name={name + (guest ? ' + guest' : '')} number={s.gcash_number} acct={s.gcash_name} busy={busy} onSubmit={(u, ref) => book(u, ref)} />
    </>
  );

  if (step === 'done' && result) {
    const paid = result.status === 'paid';
    return (
      <div className="suc-wrap">
        <div className="suc-ring" style={paid ? {} : { background: 'linear-gradient(135deg,var(--go),#b8942b)', color: '#fff' }}>{paid ? '✓' : '⏳'}</div>
        <div className="suc-ttl">{paid ? <>YOU&apos;RE <em>IN!</em></> : <>WE&apos;RE <em>CHECKING</em><br />YOUR PAYMENT</>}</div>
        <div className="suc-sub">{paid ? `See you at ${s.venue}.` : 'Your receipt is checked automatically, usually within a minute. Your spot is held while we check.'}</div>
        <div className="bcard">
          <div className="brow"><div className="bicon">👤</div><div><div className="blbl">Player</div><div className="bval">{name}{guest ? ` + ${guestName}` : ''}</div></div></div>
          <div className="brow"><div className="bicon">📅</div><div><div className="blbl">Session</div><div className="bval">{s.label}, {fmtDate(s.session_date)}</div></div></div>
          <div className="brow"><div className="bicon">📍</div><div><div className="blbl">Venue</div><div className="bval">{s.venue}</div></div></div>
          <div className="brow"><div className="bicon">💳</div><div><div className="blbl">Amount</div><div className="bval g">{peso(total)}</div></div></div>
        </div>
        <Link className="btn btn-g" href="/slots/">View my slots</Link>
      </div>
    );
  }

  return (
    <>
      <button className="back-btn" onClick={() => router.push('/?s=' + s.id)}>← Back to sessions</button>
      <div className="reg-hero">
        <div className="reg-eye">Open Play</div>
        <div className="reg-ttl">{s.label}</div>
        <div className="reg-meta">{fmtDate(s.session_date)} · {s.venue} · {fmtClock(s.time_start)}–{fmtClock(s.time_end)}</div>
      </div>
      <div className="fbody">
        <div className="fg">
          <label className="flbl">Registering as</label>
          <div style={{ padding: '14px 16px', background: 'rgba(82,183,136,.1)', border: '1.5px solid rgba(82,183,136,.35)', borderRadius: 'var(--rs)', fontWeight: 800, fontSize: 16, color: 'var(--gr)' }}>🔒 {name || '—'}</div>
        </div>
        <div className="fg" style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px 14px', background: 'rgba(var(--rgb-surface),.04)', border: '1px solid var(--b)', borderRadius: 'var(--rs)' }}>
            <input type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--pk)' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--cr)' }}>Bringing a guest? <span style={{ fontSize: 11, color: 'var(--cd)', fontWeight: 500 }}>(max 1, +{peso(s.fee)})</span></span>
          </label>
          {guest && <div style={{ marginTop: 10 }}><label className="flbl">Guest&apos;s full name</label><input className="finp" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="e.g. Juan Dela Cruz" /></div>}
        </div>
        <div className="fee-card">
          <div className="fee-ttl">Payment Summary</div>
          <div className="fee-line"><span className="fl">Open Play Fee</span><span className="fv">{peso(s.fee)}</span></div>
          {guest && <div className="fee-line"><span className="fl">Guest Fee</span><span className="fv" style={{ color: 'var(--pk)' }}>{peso(s.fee)}</span></div>}
          {fromWallet > 0 && <div className="fee-line"><span className="fl">From your MDP wallet</span><span className="fv" style={{ color: 'var(--gr)' }}>−{peso(fromWallet)}</span></div>}
          {!!s.venue_fee && <div className="fee-line"><span className="fl">Venue entrance (at door)</span><span className="fv" style={{ color: 'var(--cd)' }}>{peso(s.venue_fee)}</span></div>}
          <div className="fee-tot"><span className="fee-tot-lbl">{due > 0 ? 'GCash Total' : 'To pay now'}</span><span className="fee-tot-amt">{peso(due)}</span></div>
        </div>
        {bal > 0 && (
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, fontSize: 13, color: 'var(--cr)' }}>
            <input type="checkbox" checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--gr)' }} />
            Use my MDP wallet ({peso(bal)} available)
          </label>
        )}
        {due === 0
          ? <button className="btn btn-g" disabled={busy} onClick={() => book(null, '')}>{busy ? 'Booking…' : `Pay ${peso(total)} from wallet`}</button>
          : <>
              <div className="gcash-hint"><span>💙</span><span><strong>GCash-to-GCash only.</strong> Pay {peso(due)} on the next screen. Your spot is held once your receipt is checked.</span></div>
              <button className="btn btn-g" onClick={() => { if (guest && !guestName.trim()) { toast('Add your guest\'s full name', true); return; } setStep('gcash'); }}>Continue to GCash payment →</button>
            </>}
      </div>
    </>
  );
}
