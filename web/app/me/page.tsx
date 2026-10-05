'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { rpc, sb, useSession } from '@/lib/supabase';
import { BOOKING_STATUS, METHOD_LABEL, PAYMENT_STATUS, fmtDateTime, fmtRange, fmtDay, minutesLeft, peso } from '@/lib/format';
import { Loading, SignInPrompt, useToast } from '@/components/ui';

interface Booking { kind: 'session' | 'court'; id: string; club_name: string; club_slug: string; title: string; starts_at: string;
  ends_at: string; status: string; amount: number; paid_amount: number; guest_names: string[]; hold_expires_at: string | null; payment_status: string | null }
interface MoneyRow { at: string; club_name: string; kind: 'payment' | 'refund'; label: string; amount: number; status: string; method: string | null; note: string | null }

export default function Me() {
  const { session, ready, userId } = useSession();
  const toast = useToast();
  const [profile, setProfile] = useState<{ full_name: string; phone: string | null } | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [money, setMoney] = useState<MoneyRow[]>([]);
  const [staffClubs, setStaffClubs] = useState<{ slug: string; name: string }[]>([]);
  const [isPlatform, setIsPlatform] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data: p } = await sb().from('profiles').select('full_name, phone, is_platform_admin').eq('id', userId).single();
    setProfile(p); setIsPlatform(!!p?.is_platform_admin);
    setBookings(await rpc<Booking[]>('my_bookings'));
    setMoney(await rpc<MoneyRow[]>('my_money'));
    const { data: ms } = await sb().from('memberships').select('role, clubs(slug, name)').eq('user_id', userId)
      .in('role', ['owner', 'admin', 'host']);
    setStaffClubs((ms ?? []).map((m: any) => m.clubs));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  if (!ready) return <main className="page"><Loading /></main>;
  if (!session) return <main className="page"><SignInPrompt what="see your bookings" /></main>;

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const phone = String(f.get('phone') ?? '').replace(/\D/g, '');
    if (phone && !/^(09\d{9}|639\d{9})$/.test(phone)) { toast('Mobile number should look like 09XXXXXXXXX', true); return; }
    const { error } = await sb().from('profiles').update({ full_name: String(f.get('full_name')).trim(), phone: phone || null }).eq('id', userId!);
    if (error) toast(error.message, true); else { toast('Profile saved'); load(); }
  }
  async function cancel(b: Booking) {
    const label = b.kind === 'session' ? 'this open play booking' : 'this court booking';
    if (!confirm(`Cancel ${label}? Refunds follow the club's cancellation policy.`)) return;
    try {
      const r = await rpc<{ refund: number }>(b.kind === 'session' ? 'cancel_session_booking' : 'cancel_court_booking', { p_booking: b.id });
      toast(r.refund > 0 ? `Cancelled. The club owes you ${peso(r.refund)} and will send it to your GCash.` : 'Cancelled');
      load();
    } catch (e) { toast((e as Error).message, true); }
  }

  const upcoming = (bookings ?? []).filter((b) => Date.parse(b.ends_at) > Date.now() && !['cancelled', 'expired'].includes(b.status));
  const past = (bookings ?? []).filter((b) => !upcoming.includes(b));

  return (
    <main className="page">
      <h1>My bookings</h1>

      {(staffClubs.length > 0 || isPlatform) && (
        <div className="panel row">
          <span className="grow">You run:</span>
          {staffClubs.map((c) => <Link key={c.slug} className="btn sm court" href={`/admin/${c.slug}`}>{c.name}</Link>)}
          {isPlatform && <Link className="btn sm" href="/platform">Platform</Link>}
        </div>
      )}

      {!bookings ? <Loading /> : upcoming.length === 0 ? (
        <div className="panel"><p>No upcoming games. <Link href="/">Find a club</Link> to book one.</p></div>
      ) : (
        <div className="panel">
          {upcoming.map((b) => {
            const left = minutesLeft(b.hold_expires_at);
            const needsPay = ['pending_payment', 'waitlist_pending_payment'].includes(b.status);
            return (
              <div key={b.id} className="session" style={{ gridTemplateColumns: '74px 1fr' }}>
                <div className="when"><div className="d">{fmtDay(b.starts_at)}</div><div className="t">{fmtRange(b.starts_at, b.ends_at).split('–')[0]}</div></div>
                <div>
                  <h3>{b.title}</h3>
                  <div className="small muted">{b.club_name} · {fmtRange(b.starts_at, b.ends_at)}{b.guest_names.length ? ` · with ${b.guest_names.join(', ')}` : ''}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className={'tag ' + (b.status === 'confirmed' ? 'ok' : needsPay ? 'hold' : '')}>{BOOKING_STATUS[b.status]}</span>
                    {b.payment_status && needsPay && <span className="tag">{PAYMENT_STATUS[b.payment_status]}</span>}
                    <span className="num">{peso(b.amount)}</span>
                  </div>
                  {needsPay && b.payment_status !== 'review' && b.payment_status !== 'pending' && (
                    <p className="small" style={{ marginTop: 6 }}>
                      {left !== null && <span className="timer">Held for {left} min. </span>}
                      <Link href={`/checkout?kind=${b.kind}&id=${b.id}`}>Pay now</Link>
                    </p>
                  )}
                  <button className="linkbtn small" onClick={() => cancel(b)}>Cancel booking</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 style={{ marginTop: 28 }}>Where my money went</h2>
      <div className="panel">
        {money.length === 0 ? <p className="muted">No payments yet.</p> : (
          <table className="t">
            <tbody>
              {money.map((m, i) => (
                <tr key={i}>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fmtDay(m.at)}</td>
                  <td>
                    <div>{m.kind === 'refund' ? 'Refund: ' : ''}{m.label}</div>
                    <div className="small muted">{m.club_name}{m.method ? ` · ${METHOD_LABEL[m.method]}` : ''}{m.note ? ` · ${m.note}` : ''}</div>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div className={'num ' + (m.kind === 'refund' ? 'okc' : '')}>{m.kind === 'refund' ? '+' : ''}{peso(m.amount)}</div>
                    <div className="small muted">{m.kind === 'refund' ? ({ owed: 'Club owes you', paid: 'Sent to you', waived: 'Closed' } as Record<string, string>)[m.status] : PAYMENT_STATUS[m.status]}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {past.length > 0 && (
        <>
          <h2 style={{ marginTop: 28 }}>Past and cancelled</h2>
          <div className="panel">
            {past.map((b) => (
              <div key={b.id} className="row between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>
                <span>{b.title} · {b.club_name} · {fmtDateTime(b.starts_at)}</span>
                <span className="tag">{BOOKING_STATUS[b.status]}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 style={{ marginTop: 28 }}>Profile</h2>
      {profile && (
        <form className="panel" onSubmit={saveProfile}>
          <label className="field"><span>Full name</span><input type="text" name="full_name" defaultValue={profile.full_name} required /></label>
          <label className="field"><span>Mobile (GCash) number. Clubs send refunds here.</span>
            <input type="tel" name="phone" defaultValue={profile.phone ?? ''} placeholder="09XXXXXXXXX" /></label>
          <div className="row between">
            <button className="btn court">Save profile</button>
            <button type="button" className="linkbtn" onClick={() => sb().auth.signOut().then(() => location.assign('/'))}>Sign out</button>
          </div>
        </form>
      )}
    </main>
  );
}
