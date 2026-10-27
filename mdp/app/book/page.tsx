'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mdpApi } from '@/lib/supabase';
import { useMe, profileProblem } from '@/lib/me';
import { fmtClock, fmtDate, peso } from '@/lib/format';
import { loadSessions, type Sess } from '@/lib/sessions';
import { GcashPay } from '@/components/GcashPay';
import { Band, Empty, Loading, useToast } from '@/components/Shell';
import { Icon } from '@/components/Icon';

type Step = 'details' | 'gcash' | 'done';
interface Result { status: string; id: string }

// Booking goes through the same server as the current app, so tiers, capacity, wallet,
// receipt checks, refunds and host payouts all apply exactly as before.
export default function Book() {
  const router = useRouter();
  const toast = useToast();
  const { userId, ready, profile, wallet, reload } = useMe();
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
  useEffect(() => { if (ready && !userId) router.replace('/login/?next=' + encodeURIComponent(location.pathname + location.search)); }, [ready, userId, router]);

  if (s === undefined || !ready) return <Loading />;
  if (s === null) return <Empty title="This session isn't open for booking"><Link className="link" href="/">See all sessions</Link></Empty>;
  if (s.requires_approval) return <Empty title="The host approves players first"><Link className="link" href={'/s/?id=' + s.id}>Ask to join instead</Link></Empty>;

  const name = profile?.full_name ?? '';
  const total = Number(s.fee) * (guest ? 2 : 1);
  const bal = Math.max(0, Number(wallet ?? 0));
  const fromWallet = useWallet ? Math.min(bal, total) : 0;
  const due = total - fromWallet;

  async function book(proofUrl: string | null, ref: string) {
    const problem = profileProblem(profile); if (problem) { toast(problem, true); return; }
    if (guest && !guestName.trim()) { toast('Add your guest\'s full name.', true); return; }
    setBusy(true);
    try {
      const r = await mdpApi<Result>('register', '', { method: 'POST', body: {
        session_uuid: s!.id, player_name: name, guest_name: guest ? guestName.trim() : null, additional_member_ids: [],
        amount: s!.fee, gcash_ref: ref || null, status: 'pending', proof_url: proofUrl,
        payment_method: fromWallet > 0 ? 'wallet' : 'gcash',
      } });
      setResult(r); setStep('done'); reload();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  const head = (n: number) => (
    <>
      <h1 className="h2" style={{ color: '#fff', marginTop: 4 }}>{s.label}</h1>
      <p className="sub">{fmtDate(s.session_date)}, {fmtClock(s.time_start)} to {fmtClock(s.time_end)}, {s.venue}</p>
      <div className="steps-bar">
        <div className={n >= 1 ? 'on' : ''}><i /><span>Your spot</span></div>
        <div className={n >= 2 ? 'on' : ''}><i /><span>Pay</span></div>
        <div className={n >= 3 ? 'on' : ''}><i /><span>Done</span></div>
      </div>
    </>
  );

  if (step === 'done' && result) {
    const paid = result.status === 'paid';
    return (
      <>
        <Band>{head(3)}</Band>
        <div className="done">
          <div className={'seal' + (paid ? '' : ' wait')}><Icon name={paid ? 'check' : 'clock'} /></div>
          <h2 className="h1">{paid ? 'You\'re in' : 'Checking your receipt'}</h2>
          <p className="sub" style={{ marginTop: 6 }}>{paid ? `See you at ${s.venue}. Tap I'm here on the Courts tab when you arrive.` : 'This usually takes under a minute. Your spot is held while we check, and you\'ll get a notification.'}</p>
        </div>
        <div className="section stack">
          <div className="bill">
            <div><span>Player</span><b>{name}{guest ? ` and ${guestName}` : ''}</b></div>
            <div><span>Paid</span><b className="num">{peso(total)}</b></div>
          </div>
          <Link className="btn navy" href="/bookings/">See my bookings</Link>
        </div>
      </>
    );
  }

  if (step === 'gcash') return (
    <>
      <Band back={{ onClick: () => setStep('details'), label: 'Back' }}>
        {head(2)}
        <div className="pay-amount"><div className="small" style={{ color: 'var(--cream)' }}>Send by GCash</div><div className="num">{peso(due)}</div></div>
      </Band>
      <div className="section"><GcashPay amount={due} name={name} number={s.gcash_number} acct={s.gcash_name} busy={busy} onSubmit={(u, ref) => book(u, ref)} /></div>
    </>
  );

  return (
    <>
      <Band back={{ href: '/s/?id=' + s.id, label: 'Session' }}>{head(1)}</Band>
      <div className="section stack">
        <div className="card row"><span className="avatar" style={{ background: 'var(--ink)', color: 'var(--cream)' }}>{name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span><div><div className="small muted">Booking for</div><b>{name || '—'}</b></div></div>
        <label className={'check' + (guest ? ' on' : '')}>
          <input type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} />
          <span><b>Bring a guest</b><br /><span className="small muted">One guest, plus {peso(s.fee)}</span></span>
        </label>
        {guest && <label className="field"><span>Guest&apos;s full name</span><input className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="First and last name" /></label>}
        {bal > 0 && (
          <label className={'check' + (useWallet ? ' on' : '')}>
            <input type="checkbox" checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} />
            <span><b>Use my MDP wallet</b><br /><span className="small muted">{peso(bal)} available</span></span>
          </label>
        )}
        <div className="bill">
          <div><span>Open play</span><span className="num">{peso(s.fee)}</span></div>
          {guest && <div><span>Guest</span><span className="num">{peso(s.fee)}</span></div>}
          {fromWallet > 0 && <div><span>From your wallet</span><span className="minus num">−{peso(fromWallet)}</span></div>}
          {!!s.venue_fee && <div><span className="muted">Venue entrance, at the door</span><span className="muted num">{peso(s.venue_fee)}</span></div>}
          <div className="total"><span>{due > 0 ? 'To pay by GCash' : 'To pay now'}</span><span className="num">{peso(due)}</span></div>
        </div>
        {due === 0
          ? <button className="btn pink" disabled={busy} onClick={() => book(null, '')}>{busy ? 'Booking…' : `Pay ${peso(total)} from wallet`}</button>
          : <button className="btn pink" onClick={() => { if (guest && !guestName.trim()) { toast('Add your guest\'s full name.', true); return; } setStep('gcash'); }}>Continue to GCash</button>}
      </div>
    </>
  );
}
