'use client';
import { useCallback, useEffect, useState } from 'react';
import { rpc, sb } from '@/lib/supabase';
import { BOOKING_STATUS, ROLE_LABEL, type Court, type Role, type SessionRow, fmtDay, fmtRange, fmtTime, manilaDate, manilaInstant, peso } from '@/lib/format';
import { Loading, SeatStrip, useToast } from '@/components/ui';
import type { AdminProps } from './Overview';

interface RosterRow { booking_id: string; user_id: string; full_name: string; phone: string | null; role: Role; guest_names: string[];
  seats: number; status: string; amount: number; paid_amount: number; checked_in_at: string | null; pending_payment_status: string | null }

export default function Sessions({ club, isAdmin, onChange }: AdminProps) {
  const toast = useToast();
  const [list, setList] = useState<SessionRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [courts, setCourts] = useState<Court[]>([]);

  const load = useCallback(async () => {
    setList(await rpc<SessionRow[]>('list_sessions', { p_club: club.id, p_from: new Date(Date.now() - 2 * 864e5).toISOString(), p_days: 45 }));
  }, [club.id]);
  useEffect(() => { load(); sb().from('courts').select('*').eq('club_id', club.id).eq('active', true).order('sort').then(({ data }) => setCourts((data ?? []) as Court[])); }, [load, club.id]);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const date = String(f.get('date')), st = String(f.get('start')), en = String(f.get('end'));
    let endDate = date; if (en <= st) { const x = new Date(`${date}T12:00:00+08:00`); x.setUTCDate(x.getUTCDate() + 1); endDate = x.toISOString().slice(0, 10); }
    try {
      await rpc('create_session', {
        p_club: club.id, p_title: f.get('title'), p_starts: manilaInstant(date, st), p_ends: manilaInstant(endDate, en),
        p_fee: Number(f.get('fee')), p_capacity: Number(f.get('capacity')), p_court_ids: f.getAll('courts'),
        p_description: f.get('description') || null, p_level: f.get('level') || null, p_waitlist: f.get('waitlist') === 'on',
        p_refund_cutoff_hours: f.get('cutoff') ? Number(f.get('cutoff')) : null, p_host: null,
      });
      toast('Session created'); setCreating(false); load(); onChange();
    } catch (e) { toast((e as Error).message, true); }
  }

  if (!list) return <Loading />;
  const upcoming = list.filter((s) => Date.parse(s.ends_at) > Date.now());
  const recent = list.filter((s) => Date.parse(s.ends_at) <= Date.now()).reverse();

  return (
    <div>
      {isAdmin && !creating && <button className="btn primary" onClick={() => setCreating(true)} style={{ marginBottom: 14 }}>Create a session</button>}
      {creating && (
        <form className="panel" onSubmit={create}>
          <h3>New open play session</h3>
          <label className="field"><span>Title</span><input type="text" name="title" required defaultValue="Open Play" /></label>
          <div className="row">
            <label className="field grow"><span>Date</span><input type="date" name="date" required min={manilaDate(0)} defaultValue={manilaDate(1)} /></label>
            <label className="field grow"><span>Starts</span><input type="time" name="start" required defaultValue="18:00" step={900} /></label>
            <label className="field grow"><span>Ends</span><input type="time" name="end" required defaultValue="21:00" step={900} /></label>
          </div>
          <div className="row">
            <label className="field grow"><span>Fee per player (₱)</span><input type="number" name="fee" min={0} step={10} required defaultValue={250} /></label>
            <label className="field grow"><span>Spots</span><input type="number" name="capacity" min={1} max={500} required defaultValue={16} /></label>
            <label className="field grow"><span>Level (optional)</span><input type="text" name="level" placeholder="e.g. 3.0–3.5" /></label>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0 }}>
            <span className="small muted">Courts used (blocked from rental during the session)</span>
            <div className="row">{courts.map((c) => <label key={c.id} className="row" style={{ gap: 4 }}><input type="checkbox" name="courts" value={c.id} defaultChecked /> {c.name}</label>)}</div>
          </fieldset>
          <label className="field"><span>Details for players (optional)</span><textarea name="description" /></label>
          <div className="row">
            <label className="row" style={{ gap: 6 }}><input type="checkbox" name="waitlist" defaultChecked /> Allow a paid waitlist</label>
            <label className="field grow" style={{ margin: 0 }}><span>Free cancellation until (hours before; blank = club default {club.refund_cutoff_hours})</span><input type="number" name="cutoff" min={0} max={336} /></label>
          </div>
          <div className="row" style={{ marginTop: 12 }}><button className="btn primary">Create session</button><button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      <div className="panel">
        {upcoming.length === 0 ? <p className="muted">No upcoming sessions.</p> : upcoming.map((s) => (
          <div key={s.id}>
            <button className="session linkbtn" style={{ width: '100%', textAlign: 'left', textDecoration: 'none', color: 'inherit' }} onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
              <div className="when"><div className="d">{fmtDay(s.starts_at)}</div><div className="t">{fmtTime(s.starts_at)}</div></div>
              <div>
                <div className="row between"><h3>{s.title}</h3><span>{s.status === 'cancelled' ? <span className="tag bad">Cancelled</span> : <span className="num">{peso(s.fee)}</span>}</span></div>
                <SeatStrip capacity={s.capacity} taken={s.seats_taken} waitlist={s.waitlist_seats} />
              </div>
            </button>
            {open === s.id && <Roster s={s} isAdmin={isAdmin} clubId={club.id} onChange={() => { load(); onChange(); }} />}
          </div>
        ))}
      </div>

      {recent.length > 0 && (
        <>
          <h3>Recent</h3>
          <div className="panel">
            {recent.map((s) => (
              <div key={s.id}>
                <button className="linkbtn" onClick={() => setOpen(open === s.id ? null : s.id)}>{s.title} · {fmtDay(s.starts_at)} · {s.seats_taken}/{s.capacity}</button>
                {open === s.id && <Roster s={s} isAdmin={isAdmin} clubId={club.id} onChange={load} />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Roster({ s, isAdmin, clubId, onChange }: { s: SessionRow; isAdmin: boolean; clubId: string; onChange: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => setRows(await rpc<RosterRow[]>('session_roster', { p_session: s.id })), [s.id]);
  useEffect(() => { load(); }, [load]);

  const act = async (f: () => Promise<unknown>, ok: string) => {
    try { await f(); toast(ok); load(); onChange(); } catch (e) { toast((e as Error).message, true); }
  };
  const checkIn = (r: RosterRow) => act(() => rpc('check_in', { p_booking: r.booking_id, p_in: !r.checked_in_at }), r.checked_in_at ? 'Check-in undone' : `${r.full_name.split(' ')[0]} checked in`);
  const cash = (r: RosterRow) => {
    const owed = r.amount - r.paid_amount;
    const amt = prompt(`Cash received from ${r.full_name} (₱)`, String(owed)); if (!amt) return;
    const note = prompt('Note (e.g. "paid cash at the desk")', 'Paid cash at the club'); if (!note) return;
    act(() => rpc('record_cash_payment', { p_purpose: 'session_booking', p_booking: r.booking_id, p_amount: Number(amt), p_note: note }), 'Cash recorded');
  };
  const cancel = (r: RosterRow) => {
    const reason = prompt(`Why are you cancelling ${r.full_name}’s booking? (kept in the activity log)`); if (!reason) return;
    const refund = r.paid_amount > 0 && confirm(`Refund ${peso(r.paid_amount)} to ${r.full_name}? OK = refund, Cancel = no refund`);
    act(() => rpc('staff_cancel_session_booking', { p_booking: r.booking_id, p_refund: refund, p_reason: reason }), 'Booking cancelled');
  };
  const cancelSession = () => {
    const reason = prompt('Why is this session cancelled? Players who paid are owed a full refund.'); if (!reason) return;
    act(() => rpc('cancel_session', { p_session: s.id, p_reason: reason }), 'Session cancelled. Refunds added to the Refunds tab.');
  };
  const changeCapacity = () => {
    const v = prompt('New number of spots', String(s.capacity)); if (!v) return;
    act(() => rpc('update_session', { p_session: s.id, p_patch: { capacity: Number(v) } }), 'Spots updated (waitlist moved in if room)');
  };

  if (!rows) return <Loading />;
  const live = rows.filter((r) => r.status !== 'cancelled');
  const confirmed = live.filter((r) => r.status === 'confirmed');
  const inCount = confirmed.filter((r) => r.checked_in_at).reduce((n, r) => n + r.seats, 0);

  return (
    <div style={{ background: 'var(--ground)', borderRadius: 8, padding: 12, margin: '10px 0' }}>
      <div className="row between">
        <strong>{fmtDay(s.starts_at)}, {fmtRange(s.starts_at, s.ends_at)}</strong>
        <span className="small muted">{inCount} of {confirmed.reduce((n, r) => n + r.seats, 0)} checked in</span>
      </div>
      <div className="grid-wrap">
        <table className="t" style={{ marginTop: 8 }}>
          <thead><tr><th>Player</th><th>Status</th><th>Paid</th><th /></tr></thead>
          <tbody>
            {live.map((r) => (
              <tr key={r.booking_id}>
                <td>
                  <strong>{r.full_name}</strong>{r.role && !['member'].includes(r.role) && <span className={'tag' + (r.role === 'flagged' ? ' bad' : '')} style={{ marginLeft: 6 }}>{ROLE_LABEL[r.role]}</span>}
                  {r.guest_names.length > 0 && <div className="small muted">+ {r.guest_names.join(', ')}</div>}
                  {r.phone && <div className="small muted">{r.phone}</div>}
                </td>
                <td><span className={'tag ' + (r.status === 'confirmed' ? 'ok' : 'hold')}>{BOOKING_STATUS[r.status]}</span>
                  {r.pending_payment_status === 'review' && <div className="small err">Receipt to review</div>}</td>
                <td className="num">{peso(r.paid_amount)}{r.paid_amount < r.amount && <span className="small muted"> / {peso(r.amount)}</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.status === 'confirmed' && <button className={'btn sm' + (r.checked_in_at ? ' court' : '')} onClick={() => checkIn(r)}>{r.checked_in_at ? 'Checked in' : 'Check in'}</button>}{' '}
                  {r.paid_amount < r.amount && ['pending_payment', 'waitlist_pending_payment'].includes(r.status) && <button className="btn sm" onClick={() => cash(r)}>Took cash</button>}{' '}
                  {isAdmin && <button className="linkbtn small" onClick={() => cancel(r)}>Cancel</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {live.length === 0 && <p className="muted">No bookings yet.</p>}
      <div className="row" style={{ marginTop: 10 }}>
        {s.status === 'scheduled' && <button className="btn sm" onClick={() => setAdding(!adding)}>Add a player</button>}
        {isAdmin && s.status === 'scheduled' && <button className="btn sm" onClick={changeCapacity}>Change spots</button>}
        {isAdmin && s.status === 'scheduled' && Date.parse(s.starts_at) > Date.now() && <button className="btn sm danger" onClick={cancelSession}>Cancel session</button>}
      </div>
      {adding && <AddPlayer sessionId={s.id} clubId={clubId} fee={s.fee} onDone={() => { setAdding(false); load(); onChange(); }} />}
    </div>
  );
}

function AddPlayer({ sessionId, clubId, fee, onDone }: { sessionId: string; clubId: string; fee: number; onDone: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ user_id: string; full_name: string; phone: string | null }[] | null>(null);
  async function search() {
    try { setFound(await rpc('find_player', { p_club: clubId, p_query: q })); } catch (e) { toast((e as Error).message, true); }
  }
  async function add(uid: string, name: string) {
    const cash = prompt(`Cash received from ${name} (₱). Enter 0 if free/comp.`, String(fee)); if (cash === null) return;
    const reason = prompt('Reason (e.g. "walk-in")', 'Walk-in'); if (!reason) return;
    try {
      await rpc('staff_add_to_session', { p_session: sessionId, p_user: uid, p_guest_names: [], p_cash_paid: Number(cash), p_reason: reason, p_force: false });
      toast(`${name} added`); onDone();
    } catch (e) {
      const m = (e as Error).message;
      if (/full/i.test(m) && confirm('Session is full. Add anyway (over capacity)?')) {
        await rpc('staff_add_to_session', { p_session: sessionId, p_user: uid, p_guest_names: [], p_cash_paid: Number(cash), p_reason: reason, p_force: true });
        toast(`${name} added over capacity`); onDone();
      } else toast(m, true);
    }
  }
  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <p className="small muted">Players need a Courtside account. Search by their mobile number or email.</p>
      <div className="row"><input type="text" className="grow" style={{ width: 'auto' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="09XXXXXXXXX or email" />
        <button className="btn sm court" onClick={search}>Find</button></div>
      {found && found.length === 0 && <p className="small">No account found. Ask them to sign up, then search again.</p>}
      {found?.map((f) => <div key={f.user_id} className="row between" style={{ marginTop: 8 }}><span>{f.full_name} <span className="muted small">{f.phone}</span></span><button className="btn sm" onClick={() => add(f.user_id, f.full_name)}>Add</button></div>)}
    </div>
  );
}
