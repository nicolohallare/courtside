'use client';
import { useCallback, useEffect, useState } from 'react';
import { rpc, sb, SB_URL } from '@/lib/supabase';
import { fmtClock, fmtDate, manilaToday, peso } from '@/lib/format';
import { clubLines, clubState, loadDays, seatsIn, trainingApi, type TDay, type TLine } from '@/lib/training';
import { Band, Empty, Loading, Sheet, useToast } from '@/components/Shell';

interface Venue { id: string; name: string; active: boolean }
const blank = { session_date: '', venue_id: '', window_start: '16:00', window_end: '19:00', coach_gcash_number: '', coach_gcash_name: '', court_rate_override: '', notes: '' };

// Coaching days for admins: post a day, see who booked each hour and whether they paid the
// court share, confirm receipts the automatic check couldn't, approve shared hours, cancel a day.
export default function AdminTraining() {
  const toast = useToast();
  const [days, setDays] = useState<TDay[] | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [cancelDay, setCancelDay] = useState<TDay | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => loadDays().then((r) => setDays(r.days)).catch((e) => { toast((e as Error).message, true); setDays([]); }), [toast]);
  useEffect(() => {
    load();
    (async () => {
      const { data } = await sb().auth.getSession();
      const r = await fetch(`${SB_URL}/functions/v1/venues-api?action=list`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } }).then((x) => x.json()).catch(() => null);
      const list: Venue[] = (Array.isArray(r) ? r : r?.venues ?? []).filter((v: Venue) => v.active !== false);
      setVenues(list);
    })();
  }, [load]);

  function newDay() {
    const last = days?.[days.length - 1];
    setForm({ ...blank, coach_gcash_number: last?.coach_gcash_number ?? '', coach_gcash_name: last?.coach_gcash_name ?? '', court_rate_override: last?.court_rate_override ? String(last.court_rate_override) : '', venue_id: venues.find((v) => v.name === last?.venues?.name)?.id ?? '' });
  }
  async function create() {
    if (!form) return;
    if (!form.session_date || !form.venue_id) { toast('Pick the date and the venue.', true); return; }
    setBusy(true);
    try {
      const r = await trainingApi<{ slots: number }>('create-day', 'POST', { ...form, scope: 'mdp', court_rate_override: form.court_rate_override === '' ? null : Number(form.court_rate_override) });
      toast(`Posted: ${r.slots} one-hour slots`); setForm(null); load();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  async function review(l: TLine, decision: 'approve' | 'reject') {
    try { await trainingApi('review-line', 'PATCH', { line_id: l.id, decision, note: decision === 'reject' ? 'Receipt doesn\'t match' : null }); toast(decision === 'approve' ? 'Confirmed' : 'Rejected. The player is asked to upload again.'); load(); }
    catch (e) { toast((e as Error).message, true); }
  }
  async function join(id: string, decision: 'approve' | 'reject') {
    try { await trainingApi('review-join', 'PATCH', { booking_id: id, decision }); toast(decision === 'approve' ? 'They\'re in. Both now pay a smaller court share.' : 'Declined'); load(); }
    catch (e) { toast((e as Error).message, true); }
  }
  async function doCancel() {
    if (!cancelDay) return;
    setBusy(true);
    try { await rpc('training_day_cancel', { p_day: cancelDay.id, p_reason: reason.trim() || null }); toast('Day cancelled. Court shares paid go back to wallets.'); setCancelDay(null); setReason(''); load(); }
    catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  if (!days) return <Loading />;
  const today = manilaToday();
  const upcoming = days.filter((d) => d.session_date >= today);
  const f = (k: keyof typeof blank, label: string, type = 'text', ph = '') => form && (
    <label className="field"><span>{label}</span><input className="input" type={type} value={form[k]} placeholder={ph} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
  );

  return (
    <>
      <Band back={{ href: '/admin/', label: 'Admin' }}>
        <h1 className="h1" style={{ marginTop: 4 }}>Coaching days</h1>
        <p className="sub" style={{ marginTop: 6 }}>The app collects the court and ball boy share. Players pay the coach directly.</p>
        <button className="btn pink" style={{ marginTop: 14 }} onClick={newDay}>Post a coaching day</button>
      </Band>
      {upcoming.length === 0 && <Empty title="No coaching days coming up" />}
      {upcoming.map((d) => {
        const players = d.blocks.flatMap((b) => b.bookings.filter((k) => k.status === 'active').flatMap((k) => k.participants.filter((p) => p.status === 'in')));
        const paid = players.filter((p) => clubState(p) === 'paid').length;
        return (
          <div key={d.id} className="section">
            <div className="section-head"><span className="h3">{fmtDate(d.session_date)}, {d.venues?.name ?? ''}</span><span className="sub">{paid}/{players.length} paid</span></div>
            <div className="stack">
              {d.blocks.map((b) => (
                <div key={b.id} className="card stack">
                  <div className="between"><b>{fmtClock(b.time_start)} to {fmtClock(b.time_end)}</b><span className="small muted">{seatsIn(b)}/{b.max_pax || 2}</span></div>
                  {b.bookings.length === 0 && <div className="small muted">Nobody yet</div>}
                  {b.bookings.map((k) => k.status === 'pending' ? (
                    <div key={k.id} className="between small"><span>{k.participants.map((p) => p.display_name).join(', ')} want to share this hour</span>
                      <span className="btn-row" style={{ flex: 'none' }}><button className="btn sm green inline" onClick={() => join(k.id, 'approve')}>Let in</button><button className="btn sm ghost inline" onClick={() => join(k.id, 'reject')}>No</button></span></div>
                  ) : k.participants.filter((p) => p.status === 'in').map((p) => {
                    const st = clubState(p); const amt = clubLines(p).reduce((n, l) => n + Number(l.amount), 0);
                    const toCheck = clubLines(p).filter((l) => l.status === 'proof_uploaded');
                    return (
                      <div key={p.id} className="stack">
                        <div className="between small"><span>{p.display_name}, {peso(amt)}</span><span className={'tag ' + (st === 'paid' ? 'ok' : st === 'checking' ? 'wait' : 'off')}>{st === 'paid' ? 'Paid' : st === 'checking' ? 'Receipt to check' : st === 'due' ? 'Not paid' : '—'}</span></div>
                        {toCheck.map((l) => (
                          <div key={l.id} className="card small stack" style={{ background: 'rgba(13, 27, 42, .04)' }}>
                            {l.proof_url && <a href={l.proof_url} target="_blank" rel="noreferrer"><img src={l.proof_url} alt="Receipt" style={{ maxWidth: 120, borderRadius: 8 }} /></a>}
                            <p style={{ whiteSpace: 'pre-line' }}>{l.ai_notes ?? 'Being checked…'}</p>
                            <div className="btn-row"><button className="btn sm green" onClick={() => review(l, 'approve')}>Confirm {peso(l.amount)}</button><button className="btn sm ghost" onClick={() => review(l, 'reject')}>Reject</button></div>
                          </div>
                        ))}
                      </div>
                    );
                  }))}
                </div>
              ))}
              <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setCancelDay(d)}>Cancel this day</button>
            </div>
          </div>
        );
      })}

      {form && (
        <Sheet title="Post a coaching day" onClose={() => setForm(null)}>
          {f('session_date', 'Date', 'date')}
          <label className="field"><span>Venue</span>
            <select className="input" value={form.venue_id} onChange={(e) => setForm({ ...form, venue_id: e.target.value })}>
              <option value="">Pick a venue</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select></label>
          <div className="btn-row">{f('window_start', 'Coach from', 'time')}{f('window_end', 'Until', 'time')}</div>
          <p className="small muted" style={{ marginTop: -6, marginBottom: 12 }}>Split into one-hour slots, up to 2 players each.</p>
          {f('court_rate_override', 'Court rate per hour (optional)', 'number', 'Uses the venue rate if empty')}
          {f('coach_gcash_number', 'Coach GCash number (shown to players)', 'tel')}
          {f('coach_gcash_name', 'Coach GCash name')}
          {f('notes', 'Note for players (optional)')}
          <button className="btn pink" disabled={busy} onClick={create}>{busy ? 'Posting…' : 'Post it'}</button>
        </Sheet>
      )}
      {cancelDay && (
        <Sheet title={`Cancel ${fmtDate(cancelDay.session_date)}?`} onClose={() => setCancelDay(null)}>
          <p className="sub" style={{ marginBottom: 12 }}>Every booking is cancelled. Court shares already paid go back to players&apos; wallets; receipts still being checked are returned once confirmed.</p>
          <input className="input" placeholder="Reason players will see (optional)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginBottom: 12 }} />
          <button className="btn pink" disabled={busy} onClick={doCancel}>{busy ? 'Cancelling…' : 'Cancel the day'}</button>
        </Sheet>
      )}
    </>
  );
}
