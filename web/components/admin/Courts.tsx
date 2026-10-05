'use client';
import { useCallback, useEffect, useState } from 'react';
import { rpc, sb } from '@/lib/supabase';
import { type Court, fmtDay, fmtRange, manilaDate, manilaInstant, peso } from '@/lib/format';
import { Loading, useToast } from '@/components/ui';
import type { AdminProps } from './Overview';

interface DayRow { reservation_id: string; court_id: string; starts_at: string; ends_at: string; kind: string; source_id: string; label: string; status: string }
interface Rate { id: string; label: string; court_id: string | null; weekdays: number[]; starts: string; ends: string; hourly_rate: number; priority: number }
interface Hours { weekday: number; opens: string; closes: string }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Courts({ club, onChange }: AdminProps) {
  const toast = useToast();
  const [courts, setCourts] = useState<Court[] | null>(null);
  const [day, setDay] = useState(manilaDate(0));
  const [rows, setRows] = useState<DayRow[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [hours, setHours] = useState<Hours[]>([]);

  const load = useCallback(async () => {
    const { data } = await sb().from('courts').select('*').eq('club_id', club.id).order('sort').order('name');
    setCourts((data ?? []) as Court[]);
    const { data: r } = await sb().from('rate_rules').select('*').eq('club_id', club.id).order('priority', { ascending: false });
    setRates((r ?? []) as Rate[]);
    const { data: h } = await sb().from('club_hours').select('*').eq('club_id', club.id).order('weekday');
    setHours((h ?? []) as Hours[]);
  }, [club.id]);
  const loadDay = useCallback(async () => setRows(await rpc<DayRow[]>('club_court_day', { p_club: club.id, p_day: day })), [club.id, day]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDay(); }, [loadDay]);

  const act = async (f: () => Promise<unknown>, ok: string) => { try { await f(); toast(ok); load(); loadDay(); onChange(); } catch (e) { toast((e as Error).message, true); } };

  async function saveCourt(e: React.FormEvent<HTMLFormElement>, c: Court | null) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    await act(() => rpc('upsert_court', { p_club: club.id, p_id: c?.id ?? null, p_name: f.get('name'), p_hourly_rate: Number(f.get('rate')),
      p_surface: f.get('surface') || null, p_rentable: f.get('rentable') === 'on', p_active: f.get('active') === 'on', p_sort: Number(f.get('sort') || 0) }), 'Court saved');
    if (!c) e.currentTarget.reset();
  }
  function cancelRental(r: DayRow) {
    const reason = prompt(`Cancel ${r.label}’s court booking? Reason:`); if (!reason) return;
    const refund = confirm('Refund what they paid? OK = refund, Cancel = no refund');
    act(() => rpc('staff_cancel_court_booking', { p_booking: r.source_id, p_refund: refund, p_reason: reason }), 'Rental cancelled');
  }
  function block(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    act(() => rpc('block_court', { p_court: f.get('court'), p_start: manilaInstant(day, String(f.get('from'))), p_end: manilaInstant(day, String(f.get('to'))), p_reason: f.get('reason') }), 'Court blocked');
  }
  function saveRate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    act(() => rpc('save_rate_rule', { p_club: club.id, p_id: null, p_label: f.get('label'), p_court: f.get('court') || null,
      p_weekdays: f.getAll('wd').map(Number), p_starts: f.get('starts'), p_ends: f.get('ends'), p_rate: Number(f.get('rate')), p_priority: 1 }), 'Rate saved');
  }
  function saveHours(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const list = DAYS.map((_, i) => ({ weekday: i, open: f.get(`on${i}`) === 'on', opens: f.get(`o${i}`), closes: f.get(`c${i}`) }))
      .filter((x) => x.open).map(({ weekday, opens, closes }) => ({ weekday, opens, closes }));
    act(() => rpc('set_club_hours', { p_club: club.id, p_hours: list }), 'Opening hours saved');
  }

  if (!courts) return <Loading />;
  const name = (id: string | null) => courts.find((c) => c.id === id)?.name ?? 'All courts';

  return (
    <div>
      <h2>Bookings by day</h2>
      <div className="panel">
        <div className="row" style={{ marginBottom: 10 }}>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 'auto' }} />
          <span className="muted">{fmtDay(`${day}T12:00:00+08:00`)}</span>
        </div>
        {rows.length === 0 ? <p className="muted">Nothing booked.</p> : (
          <table className="t"><tbody>
            {rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map((r) => (
              <tr key={r.reservation_id}>
                <td className="num">{fmtRange(r.starts_at, r.ends_at)}</td>
                <td>{name(r.court_id)}</td>
                <td>{r.label} <span className={'tag ' + (r.kind === 'session' ? 'ok' : r.status === 'confirmed' ? '' : 'hold')}>{r.kind === 'session' ? 'Open play' : r.kind === 'block' ? 'Blocked' : r.status === 'confirmed' ? 'Paid' : 'Waiting for payment'}</span></td>
                <td>{r.kind === 'rental' && <button className="linkbtn small" onClick={() => cancelRental(r)}>Cancel</button>}
                  {r.kind === 'block' && <button className="linkbtn small" onClick={() => act(() => rpc('unblock_court', { p_reservation: r.reservation_id }), 'Unblocked')}>Unblock</button>}</td>
              </tr>
            ))}
          </tbody></table>
        )}
        <form className="row" onSubmit={block} style={{ marginTop: 12 }}>
          <select name="court" style={{ width: 'auto' }}>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="time" name="from" required defaultValue="12:00" style={{ width: 'auto' }} />
          <input type="time" name="to" required defaultValue="13:00" style={{ width: 'auto' }} />
          <input type="text" name="reason" placeholder="Reason (maintenance, private event)" required style={{ width: 'auto', flex: 1 }} />
          <button className="btn sm">Block court</button>
        </form>
      </div>

      <h2>Courts</h2>
      <div className="panel">
        {[...courts, null].map((c) => (
          <form key={c?.id ?? 'new'} className="row" onSubmit={(e) => saveCourt(e, c)} style={{ marginBottom: 8 }}>
            <input type="text" name="name" defaultValue={c?.name ?? ''} placeholder="New court name" required style={{ width: 140 }} />
            <label className="row" style={{ gap: 4 }}>₱<input type="number" name="rate" defaultValue={c?.hourly_rate ?? 400} min={0} step={10} style={{ width: 100 }} />/hr</label>
            <input type="text" name="surface" defaultValue={c?.surface ?? ''} placeholder="Surface" style={{ width: 110 }} />
            <input type="number" name="sort" defaultValue={c?.sort ?? 0} title="Order" style={{ width: 64 }} />
            <label className="row small" style={{ gap: 4 }}><input type="checkbox" name="rentable" defaultChecked={c?.rentable ?? true} /> Rentable</label>
            <label className="row small" style={{ gap: 4 }}><input type="checkbox" name="active" defaultChecked={c?.active ?? true} /> In use</label>
            <button className="btn sm">{c ? 'Save' : 'Add court'}</button>
          </form>
        ))}
      </div>

      <h2>Peak and special rates</h2>
      <div className="panel">
        {rates.map((r) => (
          <div key={r.id} className="row between" style={{ padding: '4px 0' }}>
            <span><strong>{r.label}</strong> · {name(r.court_id)} · {r.weekdays.map((d) => DAYS[d]).join(' ')} · {r.starts.slice(0, 5)}–{r.ends.slice(0, 5)} · <span className="num">{peso(r.hourly_rate)}/hr</span></span>
            <button className="linkbtn small" onClick={() => act(() => rpc('delete_rate_rule', { p_id: r.id }), 'Rate removed')}>Remove</button>
          </div>
        ))}
        <form onSubmit={saveRate} className="stack" style={{ marginTop: 10 }}>
          <div className="row">
            <input type="text" name="label" placeholder="e.g. Evening peak" required style={{ width: 160 }} />
            <select name="court" style={{ width: 'auto' }}><option value="">All courts</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input type="time" name="starts" defaultValue="17:00" required style={{ width: 'auto' }} />
            <input type="time" name="ends" defaultValue="22:00" required style={{ width: 'auto' }} />
            <label className="row" style={{ gap: 4 }}>₱<input type="number" name="rate" min={0} step={10} required style={{ width: 100 }} />/hr</label>
          </div>
          <div className="row">{DAYS.map((d, i) => <label key={d} className="row small" style={{ gap: 3 }}><input type="checkbox" name="wd" value={i} defaultChecked={i > 0 && i < 6} />{d}</label>)}
            <button className="btn sm">Add rate</button></div>
        </form>
      </div>

      <h2>Opening hours for rentals</h2>
      <form className="panel" onSubmit={saveHours}>
        {DAYS.map((d, i) => { const h = hours.find((x) => x.weekday === i); return (
          <div key={d} className="row" style={{ marginBottom: 6 }}>
            <label className="row" style={{ gap: 6, width: 80 }}><input type="checkbox" name={`on${i}`} defaultChecked={!!h} />{d}</label>
            <input type="time" name={`o${i}`} defaultValue={h?.opens.slice(0, 5) ?? '06:00'} style={{ width: 'auto' }} />
            <span>to</span>
            <input type="time" name={`c${i}`} defaultValue={h?.closes.slice(0, 5) ?? '00:00'} style={{ width: 'auto' }} />
          </div>); })}
        <p className="small muted">00:00 as closing time means midnight.</p>
        <button className="btn court">Save hours</button>
      </form>
    </div>
  );
}
