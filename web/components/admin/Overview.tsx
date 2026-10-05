'use client';
import { useEffect, useState } from 'react';
import { rpc, sb } from '@/lib/supabase';
import { type Club, type SessionRow, fmtDay, fmtTime, peso } from '@/lib/format';
import { Loading, SeatStrip, useToast } from '@/components/ui';

export interface AdminProps { club: Club; isAdmin: boolean; onChange: () => void }

interface Dash { received: number; received_by_method: Record<string, number>; received_sessions: number; received_courts: number;
  gateway_fees: number; refunds_owed: number; refunds_owed_count: number; to_review: number; awaiting_payment: number;
  open_alerts: number; sessions: number; seats_sold: number; court_hours: number; members: number }
interface Alert { id: number; kind: string; message: string; created_at: string }

const RANGES = { week: 7, month: 30, quarter: 90 } as const;

export default function Overview({ club, isAdmin, go }: AdminProps & { go: (t: any) => void }) {
  const toast = useToast();
  const [range, setRange] = useState<keyof typeof RANGES>('week');
  const [d, setD] = useState<Dash | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [today, setToday] = useState<SessionRow[]>([]);

  useEffect(() => {
    const to = new Date(); const from = new Date(Date.now() - RANGES[range] * 864e5);
    if (isAdmin) rpc<Dash>('club_dashboard', { p_club: club.id, p_from: from.toISOString(), p_to: to.toISOString() }).then(setD).catch((e) => toast(e.message, true));
    sb().from('alerts').select('id, kind, message, created_at').eq('club_id', club.id).is('resolved_at', null).order('created_at', { ascending: false })
      .then(({ data }) => setAlerts((data ?? []) as Alert[]));
    rpc<SessionRow[]>('list_sessions', { p_club: club.id, p_days: 2 }).then((s) => setToday(s.filter((x) => x.status === 'scheduled')));
  }, [club.id, range, isAdmin, toast]);

  async function resolve(a: Alert) {
    const note = prompt('What did you find? (kept in the activity log)');
    if (!note) return;
    try { await rpc('resolve_alert', { p_alert: a.id, p_note: note }); setAlerts(alerts.filter((x) => x.id !== a.id)); }
    catch (e) { toast((e as Error).message, true); }
  }

  return (
    <div>
      {isAdmin && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
              <button key={r} className={'btn sm' + (r === range ? ' court' : '')} onClick={() => setRange(r)}>
                {{ week: 'Last 7 days', month: 'Last 30 days', quarter: 'Last 90 days' }[r]}
              </button>
            ))}
          </div>
          {!d ? <Loading /> : (
            <div className="stats">
              <div className="stat"><div className="v">{peso(d.received)}</div><div className="k">Received ({peso(d.received_sessions)} open play, {peso(d.received_courts)} courts)</div></div>
              <div className={'stat' + (d.to_review ? ' alert' : '')} onClick={() => go('payments')} style={{ cursor: 'pointer' }}><div className="v">{d.to_review}</div><div className="k">Payments to review</div></div>
              <div className={'stat' + (d.refunds_owed ? ' alert' : '')} onClick={() => go('refunds')} style={{ cursor: 'pointer' }}><div className="v">{peso(d.refunds_owed)}</div><div className="k">Refunds owed ({d.refunds_owed_count})</div></div>
              <div className="stat"><div className="v">{peso(d.awaiting_payment)}</div><div className="k">Held, waiting for payment</div></div>
              <div className="stat"><div className="v">{d.seats_sold}</div><div className="k">Open play spots filled ({d.sessions} sessions)</div></div>
              <div className="stat"><div className="v">{d.court_hours}</div><div className="k">Court hours rented</div></div>
              <div className="stat"><div className="v">{d.members}</div><div className="k">Members</div></div>
              {d.gateway_fees > 0 && <div className="stat"><div className="v">{peso(d.gateway_fees)}</div><div className="k">Instant pay fees (paid by players)</div></div>}
            </div>
          )}
        </>
      )}

      {alerts.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--bad)' }}>
          <h3>Needs attention</h3>
          {alerts.map((a) => (
            <div key={a.id} className="row between" style={{ padding: '6px 0' }}>
              <span>{a.message} <span className="small muted">{fmtDay(a.created_at)}</span></span>
              {isAdmin && <button className="btn sm" onClick={() => resolve(a)}>Mark checked</button>}
            </div>
          ))}
        </div>
      )}

      <h2>Today and tomorrow</h2>
      <div className="panel">
        {today.length === 0 ? <p className="muted">No open play scheduled.</p> : today.map((s) => (
          <div key={s.id} className="session" style={{ cursor: 'pointer' }} onClick={() => { location.hash = 'sessions'; go('sessions'); }}>
            <div className="when"><div className="d">{fmtDay(s.starts_at)}</div><div className="t">{fmtTime(s.starts_at)}</div></div>
            <div><h3>{s.title}</h3><SeatStrip capacity={s.capacity} taken={s.seats_taken} waitlist={s.waitlist_seats} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
