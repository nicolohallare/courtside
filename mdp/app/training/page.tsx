'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { fmtClock, fmtDate, peso } from '@/lib/format';
import { clubDue, clubLines, clubState, loadDays, mine, seatsIn, trainingApi, type TBlock, type TDay, type TLine, type TMe } from '@/lib/training';
import { GcashPay } from '@/components/GcashPay';
import { Band, Empty, Loading, Sheet, useToast } from '@/components/Shell';

const STATE: Record<string, { t: string; c: string }> = { paid: { t: 'Court share paid', c: 'ok' }, checking: { t: 'Checking receipt', c: 'wait' }, due: { t: 'Court share to pay', c: 'off' }, none: { t: 'Waiting for the host', c: 'wait' } };

export default function Training() {
  const toast = useToast();
  const { userId, ready, profile, wallet, reload } = useMe();
  const [data, setData] = useState<{ days: TDay[]; me: TMe } | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const [book, setBook] = useState<{ day: TDay; block: TBlock } | null>(null);
  const [guest, setGuest] = useState('');
  const [withGuest, setWithGuest] = useState(false);
  const [paying, setPaying] = useState<TLine | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => loadDays().then(setData).catch((e) => { setErr((e as Error).message); setData(null); }), []);
  useEffect(() => { if (userId) load(); }, [userId, load]);

  if (!ready) return <Loading />;
  if (!userId) return <><Band><h1 className="h1" style={{ marginTop: 10 }}>Coaching</h1></Band><Empty title="Sign in to book coaching"><Link className="link" href="/login/?next=/training/">Sign in</Link></Empty></>;
  if (data === undefined) return <Loading />;
  if (!data) return <><Band><h1 className="h1" style={{ marginTop: 10 }}>Coaching</h1></Band><Empty title="Coaching isn't open to you yet"><p className="sub">{err}</p></Empty></>;

  const me = data.me.id;
  const upcoming = data.days.filter((d) => d.session_date >= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }));

  async function doBook() {
    if (!book) return;
    if (withGuest && guest.trim().split(/\s+/).length < 2) { toast('Add your partner\'s first and last name.', true); return; }
    setBusy(true);
    try {
      const r = await trainingApi<{ needs_approval: boolean }>('book', 'POST', { block_id: book.block.id, participants: withGuest ? [{ guest_name: guest.trim() }] : [] });
      toast(r.needs_approval ? 'Request sent. The host confirms you can share this hour.' : 'Booked. Pay the court share below to keep your slot.');
      setBook(null); setGuest(''); setWithGuest(false); load();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  async function payWallet(l: TLine) {
    setBusy(true);
    try { const r = await rpc<{ remaining_due: number }>('use_wallet_on_training_line', { p_line: l.id }); toast(r.remaining_due > 0 ? `Wallet used. ${peso(r.remaining_due)} still to send by GCash.` : 'Paid from your wallet.'); reload(); load(); }
    catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  async function attach(url: string, ref: string) {
    if (!paying) return;
    setBusy(true);
    try { await trainingApi('attach-proof', 'POST', { line_id: paying.id, proof_url: url, gcash_ref: ref || null }); toast('Receipt sent. It\'s checked automatically.'); setPaying(null); load(); }
    catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  async function cancel(id: string) {
    setBusy(true);
    try { await trainingApi('cancel-booking', 'POST', { booking_id: id }); toast('Cancelled. Any court share you paid goes back to your wallet.'); reload(); load(); }
    catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  return (
    <>
      <Band>
        <h1 className="h1" style={{ marginTop: 10 }}>Coaching</h1>
        <p className="sub" style={{ marginTop: 6 }}>Book an hour with the coach, alone or with a partner. You pay the court and ball boy share to the club here, and pay the coach directly.</p>
      </Band>
      {upcoming.length === 0 && <Empty title="No coaching days posted yet"><p className="sub">You&apos;ll get a notification when the next one is up.</p></Empty>}
      {upcoming.map((d) => (
        <div key={d.id} className="section">
          <div className="section-head"><span className="h3">{fmtDate(d.session_date)}</span><span className="sub">{d.venues?.name ?? ''}</span></div>
          <div className="card small" style={{ marginBottom: 10 }}>
            <b>{d.coach_name ?? 'Coach'}</b>: {peso(d.coach_fee_per_head ?? 1500)} per player, paid to the coach directly{d.coach_gcash_number ? ` (GCash ${d.coach_gcash_number}${d.coach_gcash_name ? `, ${d.coach_gcash_name}` : ''})` : ''}.
            {d.notes && <><br />{d.notes}</>}
          </div>
          <div className="stack">
            {d.blocks.map((b) => {
              const seats = seatsIn(b), max = b.max_pax || 2;
              const myBk = b.bookings.find((k) => k.participants.some((p) => mine(p, me)));
              const names = b.bookings.filter((k) => k.status === 'active').flatMap((k) => k.participants.filter((p) => p.status === 'in').map((p) => p.display_name));
              return (
                <div key={b.id} className="card stack">
                  <div className="between">
                    <div><b>{fmtClock(b.time_start)} to {fmtClock(b.time_end)}</b><div className="small muted">{names.length ? names.join(', ') : 'Open'}</div></div>
                    {myBk ? <span className={'tag ' + (myBk.status === 'pending' ? 'wait' : 'ok')}>{myBk.status === 'pending' ? 'Waiting for the host' : 'Yours'}</span>
                      : seats >= max || b.roster_locked_at ? <span className="tag off">{b.roster_locked_at ? 'Closed' : 'Full'}</span>
                      : <button className="btn sm pink inline" onClick={() => { setBook({ day: d, block: b }); setWithGuest(false); }}>{seats ? 'Join' : 'Book'}</button>}
                  </div>
                  {myBk && myBk.status === 'active' && myBk.participants.filter((p) => mine(p, me) && p.status === 'in').map((p) => {
                    const st = clubState(p); const due = clubDue(p);
                    return (
                      <div key={p.id} className="stack">
                        <div className="between small"><span>{p.member_id ? 'You' : p.display_name}: {peso(clubLines(p).reduce((n, l) => n + Number(l.amount), 0))}</span><span className={'tag ' + STATE[st].c}>{STATE[st].t}</span></div>
                        {due > 0 && clubLines(p).filter((l) => l.status === 'unpaid' || l.status === 'rejected').map((l) => (
                          <div key={l.id} className="btn-row">
                            {Number(wallet ?? 0) > 0 && l.status === 'unpaid' && <button className="btn sm green" disabled={busy} onClick={() => payWallet(l)}>Pay from wallet</button>}
                            <button className="btn sm pink" onClick={() => setPaying(l)}>Pay {peso(l.amount)} by GCash</button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {myBk && <button className="link small" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => cancel(myBk.id)}>Cancel my booking</button>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="small muted" style={{ padding: '0 20px 24px' }}>The court share is split between the players in the hour. If someone joins yours, the difference goes back to your wallet. Unpaid slots are released after 12 hours.</p>

      {book && (
        <Sheet title={`${fmtClock(book.block.time_start)} on ${fmtDate(book.day.session_date)}`} onClose={() => setBook(null)}>
          <div className="stack">
            {seatsIn(book.block) === 0 && <>
              <label className={'check' + (!withGuest ? ' on' : '')}><input type="radio" checked={!withGuest} onChange={() => setWithGuest(false)} /><span><b>Just me</b><br /><span className="small muted">Someone else can join and share the court.</span></span></label>
              <label className={'check' + (withGuest ? ' on' : '')}><input type="radio" checked={withGuest} onChange={() => setWithGuest(true)} /><span><b>With a partner</b><br /><span className="small muted">You pay their court share too.</span></span></label>
              {withGuest && <input className="input" placeholder="Partner's first and last name" value={guest} onChange={(e) => setGuest(e.target.value)} />}
            </>}
            {seatsIn(book.block) > 0 && <p className="small">Someone is already in this hour. The host confirms you can share it, then you pay your court share.</p>}
            <p className="small muted">Coach fee: {peso(book.day.coach_fee_per_head ?? 1500)} per player, paid to the coach directly.</p>
            <button className="btn pink" disabled={busy} onClick={doBook}>{busy ? 'Booking…' : seatsIn(book.block) ? 'Ask to join' : 'Book this hour'}</button>
          </div>
        </Sheet>
      )}
      {paying && (
        <Sheet title={`Pay ${peso(paying.amount)} court share`} onClose={() => setPaying(null)}>
          <GcashPay amount={Number(paying.amount)} name={profile?.full_name ?? ''} number={paying.payee_gcash_number} acct={paying.payee_gcash_name} busy={busy} onSubmit={attach}
            note="Checked automatically, usually within a minute." />
        </Sheet>
      )}
    </>
  );
}
