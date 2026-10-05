'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc, sb } from '@/lib/supabase';
import { useClub } from '@/lib/club';
import { type Court, fmtDay, manilaDate, manilaInstant, peso } from '@/lib/format';
import { Loading, TrustLine, useToast } from '@/components/ui';
import { BookingGate } from '@/components/gate';

interface Taken { court_id: string; starts_at: string; ends_at: string; kind: string }
interface Hours { weekday: number; opens: string; closes: string }

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const label = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12}${m % 60 ? ':' + String(m % 60).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };

export default function Courts() {
  const { slug } = useParams<{ slug: string }>();
  const c = useClub(slug);
  const router = useRouter();
  const toast = useToast();
  const [courts, setCourts] = useState<Court[]>([]);
  const [hours, setHours] = useState<Hours[]>([]);
  const [day, setDay] = useState(manilaDate(0));
  const [taken, setTaken] = useState<Taken[]>([]);
  const [sel, setSel] = useState<{ court: string; start: number; slots: number } | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!c.club) return;
    sb().from('courts').select('*').eq('club_id', c.club.id).eq('active', true).eq('rentable', true).order('sort').order('name')
      .then(({ data }) => setCourts((data ?? []) as Court[]));
    sb().from('club_hours').select('*').eq('club_id', c.club.id).then(({ data }) => setHours((data ?? []) as Hours[]));
  }, [c.club]);
  const loadTaken = useCallback(async () => {
    if (!c.club) return;
    setTaken(await rpc<Taken[]>('court_availability', { p_club: c.club.id, p_day: day }));
  }, [c.club, day]);
  useEffect(() => { loadTaken(); setSel(null); }, [loadTaken]);

  const step = c.club?.court_slot_minutes ?? 60;
  const weekday = new Date(`${day}T12:00:00+08:00`).getUTCDay();
  const h = hours.find((x) => x.weekday === weekday);
  const rows = useMemo(() => {
    if (!h) return [];
    const o = toMin(h.opens); let cl = toMin(h.closes); if (cl <= o) cl += 1440;
    const out: number[] = []; for (let m = o; m + step <= cl; m += step) out.push(m);
    return out;
  }, [h, step]);

  const instant = (m: number) => manilaInstant(m >= 1440 ? addDay(day) : day, hhmm(m));
  function status(courtId: string, m: number): 'free' | 'rental' | 'session' | 'block' | 'past' {
    const a = Date.parse(instant(m)), b = a + step * 60000;
    if (a < Date.now()) return 'past';
    const hit = taken.find((t) => t.court_id === courtId && Date.parse(t.starts_at) < b && Date.parse(t.ends_at) > a);
    return hit ? (hit.kind as 'rental' | 'session' | 'block') : 'free';
  }

  function tap(courtId: string, m: number) {
    const minSlots = Math.ceil((c.club?.court_min_minutes ?? 60) / step);
    const maxSlots = Math.floor((c.club?.court_max_minutes ?? 180) / step);
    if (sel && sel.court === courtId && m >= sel.start && m < sel.start + sel.slots * step) { setSel(null); return; }
    if (sel && sel.court === courtId && m === sel.start + sel.slots * step && sel.slots < maxSlots) { setSel({ ...sel, slots: sel.slots + 1 }); return; }
    // new selection: take the minimum length if free
    let n = 0; while (n < minSlots && rows.includes(m + n * step) && status(courtId, m + n * step) === 'free') n++;
    if (n < minSlots) { toast(`Bookings are at least ${c.club?.court_min_minutes} minutes`, true); return; }
    setSel({ court: courtId, start: m, slots: n });
  }

  useEffect(() => {
    if (!sel) { setPrice(null); return; }
    rpc<number>('court_price', { p_court: sel.court, p_start: instant(sel.start), p_end: instant(sel.start + sel.slots * step) })
      .then(setPrice).catch(() => setPrice(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  async function book() {
    if (!sel) return;
    setBusy(true);
    try {
      const r = await rpc<{ booking_id: string; status: string }>('book_court', {
        p_court: sel.court, p_start: instant(sel.start), p_end: instant(sel.start + sel.slots * step) });
      if (r.status === 'confirmed') { toast('Court booked'); router.push('/me'); }
      else router.push(`/checkout?kind=court&id=${r.booking_id}`);
    } catch (e) { toast((e as Error).message, true); loadTaken(); setSel(null); }
    setBusy(false);
  }

  if (c.club === undefined) return <main className="page"><Loading /></main>;
  if (!c.club) return <main className="page"><h1>Club not found</h1></main>;
  const days = Array.from({ length: Math.min(c.club.court_booking_days_ahead, 14) + 1 }, (_, i) => manilaDate(i));
  const selCourt = courts.find((x) => x.id === sel?.court);

  return (
    <main className="page wide">
      <p className="small"><Link href={`/c/${slug}`}>{c.club.name}</Link></p>
      <h1>Rent a court</h1>
      <BookingGate c={c} />

      <div className="row" style={{ overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: 6, marginBottom: 10 }}>
        {days.map((d) => (
          <button key={d} className={'btn sm' + (d === day ? ' court' : '')} onClick={() => setDay(d)} aria-pressed={d === day}>
            {fmtDay(`${d}T12:00:00+08:00`)}
          </button>
        ))}
      </div>

      {!h ? <div className="panel"><p>Closed on this day.</p></div> : courts.length === 0 ? <div className="panel"><p>No courts are open for rental.</p></div> : (
        <div className="panel grid-wrap">
          <p className="small muted" style={{ marginTop: 0 }}>Tap a start time. Tap the next slot to make it longer.</p>
          <div className="cgrid" style={{ gridTemplateColumns: `56px repeat(${courts.length}, minmax(84px, 1fr))` }}>
            <div />
            {courts.map((ct) => <div key={ct.id} className="hd">{ct.name}</div>)}
            {rows.map((m) => (
              <Row key={m} m={m} courts={courts} status={status} sel={sel} step={step} tap={tap} canBook={c.canBook} />
            ))}
          </div>
        </div>
      )}

      {sel && selCourt && (
        <div className="panel stack" style={{ position: 'sticky', bottom: 10, boxShadow: '0 6px 24px rgba(20,36,48,.18)' }}>
          <div className="row between">
            <div>
              <strong>{selCourt.name}</strong> · {fmtDay(instant(sel.start))}<br />
              <span className="num" style={{ fontSize: '1.3rem' }}>{label(sel.start)}–{label(sel.start + sel.slots * step)}</span>
            </div>
            <span className="amount" style={{ fontSize: '2.2rem' }}>{price === null ? '…' : peso(price)}</span>
          </div>
          <button className="btn primary block" disabled={busy || !c.canBook} onClick={book}>Book and pay</button>
          <TrustLine club={c.club.name} />
        </div>
      )}
    </main>
  );
}

function Row({ m, courts, status, sel, step, tap, canBook }: {
  m: number; courts: Court[]; status: (c: string, m: number) => string; sel: { court: string; start: number; slots: number } | null;
  step: number; tap: (c: string, m: number) => void; canBook: boolean;
}) {
  return (
    <>
      <div className="tm">{label(m)}</div>
      {courts.map((ct) => {
        const st = status(ct.id, m);
        const isSel = !!sel && sel.court === ct.id && m >= sel.start && m < sel.start + sel.slots * step;
        const cls = 'slot' + (isSel ? ' sel' : st === 'session' ? ' session' : st !== 'free' ? ' taken' : '');
        return (
          <button key={ct.id} className={cls} disabled={!canBook || (st !== 'free' && !isSel)}
            onClick={() => tap(ct.id, m)}
            aria-label={`${ct.name} ${label(m)} ${st === 'free' ? 'available' : st === 'session' ? 'open play' : 'taken'}`}>
            {isSel ? '✓' : st === 'session' ? 'Open play' : st === 'rental' || st === 'block' ? 'Taken' : ''}
          </button>
        );
      })}
    </>
  );
}

function addDay(d: string) {
  const x = new Date(`${d}T12:00:00+08:00`); x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}
