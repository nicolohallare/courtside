'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { callFunction, rpc, sb, useSession } from '@/lib/supabase';
import { type Club, fmtDay, fmtRange, minutesLeft, peso } from '@/lib/format';
import { Loading, SignInPrompt, TrustLine, useToast } from '@/components/ui';

interface Due { title: string; when: string; amount: number; paid: number; status: string; hold: string | null; club: Club }

function CheckoutInner() {
  const q = useSearchParams();
  const kind = q.get('kind') === 'court' ? 'court' : 'session';
  const id = q.get('id') ?? '';
  const purpose = kind === 'session' ? 'session_booking' : 'court_booking';
  const { session, ready, userId } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [due, setDue] = useState<Due | null | undefined>(undefined);
  const [method, setMethod] = useState<'gcash' | 'instant'>('gcash');
  const [instantOk, setInstantOk] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!userId || !id) return;
    (async () => {
      if (kind === 'session') {
        const { data: b } = await sb().from('session_bookings').select('amount, paid_amount, status, hold_expires_at, guest_names, sessions(title, starts_at, ends_at), clubs(*)').eq('id', id).maybeSingle();
        if (!b) { setDue(null); return; }
        const s = (b as any).sessions;
        setDue({ title: s.title + (b.guest_names.length ? ` (you + ${b.guest_names.length})` : ''), when: `${fmtDay(s.starts_at)}, ${fmtRange(s.starts_at, s.ends_at)}`,
          amount: b.amount, paid: b.paid_amount, status: b.status, hold: b.hold_expires_at, club: (b as any).clubs });
      } else {
        const { data: b } = await sb().from('court_bookings').select('amount, paid_amount, status, hold_expires_at, starts_at, ends_at, courts(name), clubs(*)').eq('id', id).maybeSingle();
        if (!b) { setDue(null); return; }
        setDue({ title: `${(b as any).courts.name} rental`, when: `${fmtDay(b.starts_at)}, ${fmtRange(b.starts_at, b.ends_at)}`,
          amount: b.amount, paid: b.paid_amount, status: b.status, hold: b.hold_expires_at, club: (b as any).clubs });
      }
      // an existing receipt being checked? go to its status page
      const { data: p } = await sb().from('payments').select('id').eq('purpose', purpose).eq('purpose_id', id)
        .in('status', ['pending', 'review']).eq('method', 'gcash_receipt').maybeSingle();
      if (p) router.replace(`/pay/${p.id}`);
    })();
  }, [userId, id, kind, purpose, router]);

  useEffect(() => {
    if (!due) return;
    (async () => {
      const live = await rpc<string>('cfg', { p_key: 'gateway_live', p_default: 'false' });
      const staff = await rpc<boolean>('is_club_staff', { p_club: due.club.id });
      const ok = due.club.techpay_enabled && (live === 'true' || (live === 'admins' && staff));
      setInstantOk(ok);
      if (ok && !due.club.gcash_number) setMethod('instant');
    })();
  }, [due]);

  if (!ready || due === undefined && session) return <main className="page"><Loading /></main>;
  if (!session) return <main className="page"><SignInPrompt what="pay" /></main>;
  if (!due) return <main className="page"><h1>Booking not found</h1><Link href="/me">My bookings</Link></main>;

  const owed = Number(due.amount) - Number(due.paid);
  const left = minutesLeft(due.hold);
  const payable = ['pending_payment', 'waitlist_pending_payment'].includes(due.status) && owed > 0;

  async function sendReceipt() {
    if (!file) { toast('Add your receipt screenshot first', true); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Screenshot is over 5 MB. Crop it and try again.', true); return; }
    if (!/image\/(jpeg|png|webp)/.test(file.type)) { toast('Use a JPG or PNG screenshot', true); return; }
    setBusy(true);
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const up = await sb().storage.from('receipts').upload(path, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      const pid = await rpc<string>('submit_receipt', { p_purpose: purpose, p_booking: id, p_proof_path: path, p_reported_ref: ref || null });
      callFunction('verify-receipt', { payment_id: pid }).catch(() => {});  // status page polls the result
      router.push(`/pay/${pid}`);
    } catch (e) { toast((e as Error).message, true); setBusy(false); }
  }
  async function payInstant() {
    setBusy(true);
    try {
      const r = await callFunction<{ pay_url: string }>('techpay', { purpose, booking_id: id }, '?action=start');
      location.href = r.pay_url;
    } catch (e) { toast((e as Error).message, true); setBusy(false); }
  }

  return (
    <main className="page">
      <h1>Pay {due.club.name}</h1>
      <div className="panel">
        <div className="row between">
          <div><strong>{due.title}</strong><div className="small muted">{due.when}</div></div>
          <span className="amount">{peso(owed)}</span>
        </div>
        {payable && left !== null && <p className="timer small" style={{ marginTop: 8 }}>Your spot is held for {left} more minute{left === 1 ? '' : 's'}.</p>}
        {due.status === 'waitlist_pending_payment' && <p className="small muted">This holds your waitlist place. If no spot opens, the club refunds you in full.</p>}
      </div>

      {!payable ? (
        <div className="panel"><p>{due.status === 'expired' ? 'This hold expired. Please book again.' : 'Nothing to pay on this booking.'}</p><Link href="/me">My bookings</Link></div>
      ) : (
        <>
          <TrustLine club={due.club.name} />
          <div className="stack" style={{ marginTop: 14 }}>
            {due.club.gcash_number && (
              <button className="payopt" aria-pressed={method === 'gcash'} onClick={() => setMethod('gcash')}>
                <strong>GCash transfer</strong> <span className="tag ok">No fee</span>
                <div className="small muted">Send to the club’s GCash, upload the receipt. It’s checked in about a minute.</div>
              </button>
            )}
            {instantOk && (
              <button className="payopt" aria-pressed={method === 'instant'} onClick={() => setMethod('instant')}>
                <strong>Instant pay</strong> <span className="small muted">GCash, Maya, QR Ph, cards</span>
                <div className="small muted">Confirmed right away. A payment fee (about 1.75% for QR Ph, 3% for cards) is shown on the next page.</div>
              </button>
            )}
          </div>

          {method === 'gcash' && due.club.gcash_number && (
            <div className="panel stack" style={{ marginTop: 14 }}>
              <div>
                <div className="small muted">Send exactly</div>
                <div className="amount" style={{ fontSize: '2.2rem' }}>{peso(owed)}</div>
              </div>
              <div>
                <div className="small muted">to the club’s GCash</div>
                <div className="row">
                  <span className="gnum">{due.club.gcash_number.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3')}</span>
                  <button className="btn sm" onClick={() => navigator.clipboard?.writeText(due.club.gcash_number!).then(() => toast('Number copied'))}>Copy</button>
                </div>
                {due.club.gcash_name && <div className="small">{due.club.gcash_name}</div>}
              </div>
              <hr style={{ margin: 0 }} />
              <label className="field"><span>Receipt screenshot</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <label className="field"><span>Reference number (optional, helps the check)</span>
                <input type="text" inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="13-digit Ref No." />
              </label>
              <button className="btn primary block" disabled={busy || !file} onClick={sendReceipt}>{busy ? 'Uploading…' : 'Send receipt'}</button>
              <p className="small muted">Only send to the number above. Money sent to anyone else can’t be traced by the club.</p>
            </div>
          )}
          {method === 'instant' && instantOk && (
            <div className="panel" style={{ marginTop: 14 }}>
              <button className="btn primary block" disabled={busy} onClick={payInstant}>{busy ? 'Opening…' : `Pay ${peso(owed)} + fee`}</button>
              <p className="small muted" style={{ marginTop: 8 }}>You’ll choose GCash, Maya, a bank app or a card on TechPay’s secure page, then come back here.</p>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default function Checkout() { return <Suspense><CheckoutInner /></Suspense>; }
