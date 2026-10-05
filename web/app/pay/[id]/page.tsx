'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { callFunction, sb, useSession } from '@/lib/supabase';
import { BOOKING_STATUS, METHOD_LABEL, peso } from '@/lib/format';
import { Loading, SignInPrompt } from '@/components/ui';

interface P { id: string; amount: number; method: string; status: string; purpose: string; purpose_id: string; ai_notes: string | null; review_note: string | null; club_id: string }

function PayStatusInner() {
  const { id } = useParams<{ id: string }>();
  const back = useSearchParams().get('r');
  const { session, ready } = useSession();
  const [p, setP] = useState<P | null | undefined>(undefined);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const nudged = useRef(false);

  useEffect(() => {
    if (!session) return;
    let stop = false;
    const load = async () => {
      const { data } = await sb().from('payments').select('id, amount, method, status, purpose, purpose_id, ai_notes, review_note, club_id').eq('id', id).maybeSingle();
      if (stop) return;
      setP(data as P);
      if (data) {
        const t = data.purpose === 'session_booking' ? 'session_bookings' : 'court_bookings';
        const { data: b } = await sb().from(t).select('status').eq('id', data.purpose_id).maybeSingle();
        setBookingStatus(b?.status ?? null);
        if (data.method === 'techpay' && data.status === 'pending' && back === 'done' && !nudged.current) {
          nudged.current = true;
          callFunction('techpay', { payment_id: id }, '?action=check').catch(() => {});
        }
      }
      setPolls((n) => n + 1);
    };
    load();
    let n = 0;
    const t = setInterval(() => { if (++n <= 40) load(); else clearInterval(t); }, 4000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, id, back]);

  if (!ready || (session && p === undefined)) return <main className="page"><Loading /></main>;
  if (!session) return <main className="page"><SignInPrompt what="see this payment" /></main>;
  if (!p) return <main className="page"><h1>Payment not found</h1><Link href="/me">My bookings</Link></main>;

  const kind = p.purpose === 'session_booking' ? 'session' : 'court';
  return (
    <main className="page">
      <h1>{p.status === 'approved' ? 'Paid' : p.status === 'rejected' ? 'Payment not accepted' : p.status === 'review' ? 'The club is checking your payment' : 'Checking your payment…'}</h1>
      <div className="panel stack">
        <div className="row between"><span>{METHOD_LABEL[p.method]}</span><span className="amount" style={{ fontSize: '2.2rem' }}>{peso(p.amount)}</span></div>
        {bookingStatus && <p><span className={'tag ' + (bookingStatus === 'confirmed' ? 'ok' : 'hold')}>{BOOKING_STATUS[bookingStatus]}</span></p>}
        {p.status === 'pending' && (
          <p className="muted">{p.method === 'techpay' ? 'Waiting for confirmation from TechPay. This usually takes a few seconds.' : 'Reading your receipt. This usually takes under a minute.'}
            {polls >= 40 && ' It’s taking longer than usual. You’ll see the result under My bookings.'}</p>
        )}
        {p.status === 'review' && <p>Something on the receipt needs a person to look at it. Your spot stays held while the club checks. No need to pay again.</p>}
        {p.status === 'rejected' && (
          <>
            <p>{p.review_note || p.ai_notes?.split('\n')[0] || 'The club couldn’t match this payment.'}</p>
            <Link className="btn primary block" href={`/checkout?kind=${kind}&id=${p.purpose_id}`}>Try again</Link>
          </>
        )}
        {p.status === 'approved' && bookingStatus === 'confirmed' && <p>You’re in. See you on court.</p>}
        {p.status === 'approved' && bookingStatus === 'waitlisted' && <p>You’re on the waitlist. If a spot opens you’re moved in automatically; if not, the club refunds you.</p>}
        {p.status === 'approved' && bookingStatus && !['confirmed', 'waitlisted'].includes(bookingStatus) && (
          <p>Your payment arrived after the booking lapsed, so the club owes you a refund. It’s listed under My bookings.</p>
        )}
      </div>
      <Link href="/me">Go to My bookings</Link>
    </main>
  );
}

export default function PayStatus() { return <Suspense><PayStatusInner /></Suspense>; }
