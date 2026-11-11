'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mdpApi, rpc } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { peso } from '@/lib/format';
import { topUpWithTechPay } from '@/lib/events';
import { GcashPay } from '@/components/GcashPay';
import { Band, Empty, Loading, useToast } from '@/components/Shell';

interface Club { default_gcash_number: string | null; default_gcash_name: string | null; backup_gcash_number: string | null; backup_gcash_name: string | null; primary_gcash_owner_user_id: string | null }
const QRPH = 0.0175, CARD = 0.03;

// Add money to the MDP wallet: send GCash and upload the receipt (free, checked automatically),
// or pay instantly through TechPay (GCash, Maya, banks, cards; the gateway's fee is added).
export default function Topup() {
  const router = useRouter();
  const toast = useToast();
  const { userId, ready, profile, wallet, reload } = useMe();
  const [club, setClub] = useState<Club | null>(null);
  const [instant, setInstant] = useState(false);
  const [route, setRoute] = useState<'gcash' | 'instant'>('gcash');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => { if (ready && !userId) router.replace('/login/?next=/topup/'); }, [ready, userId, router]);
  useEffect(() => {
    if (!userId) return;
    mdpApi<Club>('club-settings').then(setClub).catch(() => setClub(null));
    rpc<boolean>('can_use_gateway_topup').then((v) => setInstant(v === true)).catch(() => setInstant(false));
    const a = new URLSearchParams(location.search).get('amount'); if (a && Number(a) > 0) setAmount(String(Math.ceil(Number(a))));
  }, [userId]);

  if (!ready || !userId) return <Loading />;
  if (sent) return (
    <>
      <Band><h1 className="h1" style={{ marginTop: 10 }}>Receipt sent</h1></Band>
      <Empty title="We're checking your receipt">
        <p className="sub">It usually takes under a minute. Your wallet goes up once it&apos;s confirmed, and you&apos;ll get a notification.</p>
        <Link className="btn navy" href="/bookings/#wallet" style={{ marginTop: 14 }}>See my wallet</Link>
      </Empty>
    </>
  );

  // The club's own GCash owner tops up to the backup number, so the transfer is visible to someone else.
  const own = !!club?.primary_gcash_owner_user_id && club.primary_gcash_owner_user_id === profile?.id && !!club.backup_gcash_number;
  const number = own ? club!.backup_gcash_number : club?.default_gcash_number ?? null;
  const acct = own ? club!.backup_gcash_name : club?.default_gcash_name ?? null;
  const amt = Math.floor(Number(amount) || 0);
  const ok = amt >= 1 && amt <= 100000;

  async function submitGcash(url: string, ref: string) {
    if (!ok) { toast('Enter the amount you sent.', true); return; }
    setBusy(true);
    try { await mdpApi('topup-submit', '', { method: 'POST', body: { amount: amt, proof_url: url, gcash_ref: ref || null } }); setSent(true); setTimeout(reload, 15000); }
    catch (e) {
      // The server sometimes answers with an error after saving it; check before saying it failed.
      const mine = await mdpApi<{ amount: number; created_at: string }[]>('my-topups').catch(() => []);
      if (mine.some((t) => Number(t.amount) === amt && Date.now() - Date.parse(t.created_at) < 90_000)) setSent(true);
      else toast((e as Error).message, true);
    }
    setBusy(false);
  }
  async function payInstant() {
    if (amt < 100 || amt > 20000) { toast('Instant pay takes ₱100 to ₱20,000.', true); return; }
    setBusy(true);
    try { await topUpWithTechPay(amt, '/bookings/#wallet'); } catch (e) { toast((e as Error).message, true); setBusy(false); }
  }

  return (
    <>
      <Band back={{ href: '/bookings/#wallet', label: 'Wallet' }}>
        <h1 className="h1" style={{ marginTop: 4 }}>Top up your wallet</h1>
        <p className="sub" style={{ marginTop: 6 }}>Balance {wallet === null ? '—' : peso(wallet)}. Use it to book in one tap, and refunds come back here.</p>
      </Band>
      <div className="section stack">
        <label className="field" style={{ marginBottom: 0 }}><span>Amount</span><input className="input num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="₱0" /></label>
        <div className="chips">{[500, 1000, 2000].map((a) => <button key={a} type="button" className={'chip' + (amt === a ? ' on' : '')} onClick={() => setAmount(String(a))}>{peso(a)}</button>)}</div>
        {instant && (
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={route === 'gcash'} className={route === 'gcash' ? 'on' : ''} onClick={() => setRoute('gcash')}>GCash receipt, free</button>
            <button role="tab" aria-selected={route === 'instant'} className={route === 'instant' ? 'on' : ''} onClick={() => setRoute('instant')}>Instant pay</button>
          </div>
        )}
        {route === 'instant' && instant ? (
          <div className="card stack">
            <p className="small">Pay on TechPay&apos;s secure page with GCash, Maya, your bank or a card. Your wallet goes up as soon as it&apos;s paid, no receipt needed.</p>
            {amt >= 100 && <div className="bill">
              <div><span>GCash, Maya, banks, QR Ph</span><span className="num">{peso(Math.round(amt * (1 + QRPH) * 100) / 100)}</span></div>
              <div><span>Visa, Mastercard, JCB</span><span className="num">{peso(Math.round(amt * (1 + CARD) * 100) / 100)}</span></div>
              <div className="total"><span>Your wallet gets</span><span className="num">{peso(amt)}</span></div>
            </div>}
            <button className="btn pink" disabled={busy || amt < 100} onClick={payInstant}>{busy ? 'Opening TechPay…' : amt >= 100 ? `Continue to pay ${peso(amt)}` : 'Enter at least ₱100'}</button>
          </div>
        ) : !club ? <Loading rows={1} /> : !number ? <div className="err">The club GCash number isn&apos;t set up. Tell an admin.</div> : (
          <>
            <p className="small muted">Send {ok ? peso(amt) : 'the amount'} to the club GCash below, then upload the screenshot. It&apos;s free and checked automatically.</p>
            <GcashPay amount={amt} name={profile?.full_name ?? ''} number={number} acct={acct} busy={busy} onSubmit={submitGcash} note="Checked automatically, usually within a minute. Your wallet goes up once it's confirmed." />
          </>
        )}
      </div>
    </>
  );
}
