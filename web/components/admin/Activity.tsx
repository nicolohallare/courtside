'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';
import { fmtDateTime } from '@/lib/format';
import { Loading } from '@/components/ui';
import type { AdminProps } from './Overview';

interface Entry { id: number; actor: string | null; action: string; details: Record<string, unknown>; created_at: string }
const ACTION: Record<string, string> = {
  'payment.approve': 'Approved a payment', 'payment.reject': 'Rejected a payment', 'payment.cash': 'Recorded cash',
  'booking.staff_add': 'Added a player', 'booking.staff_cancel': 'Cancelled a booking', 'booking.promoted': 'Moved a player in from the waitlist',
  'court_booking.staff_cancel': 'Cancelled a court rental', 'session.create': 'Created a session', 'session.update': 'Edited a session',
  'session.cancel': 'Cancelled a session', 'refund.paid': 'Sent a refund', 'refund.waived': 'Closed a refund', 'member.role': 'Changed a role',
  'rules.publish': 'Published house rules', 'rules.window': 'Changed booking windows', 'club.update': 'Changed settings',
  'court.save': 'Saved a court', 'court.block': 'Blocked a court', 'court.unblock': 'Unblocked a court', 'rate.save': 'Saved a rate',
  'rate.delete': 'Removed a rate', 'club.hours': 'Changed opening hours', 'alert.resolve': 'Checked an alert', 'club.create': 'Created the club',
};

export default function Activity({ club }: AdminProps) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    sb().from('audit_log').select('*').eq('club_id', club.id).order('created_at', { ascending: false }).limit(300).then(async ({ data }) => {
      const list = (data ?? []) as Entry[]; setRows(list);
      const ids = [...new Set(list.map((r) => r.actor).filter(Boolean))] as string[];
      if (ids.length) {
        const { data: ps } = await sb().from('profiles').select('id, full_name').in('id', ids);
        setNames(Object.fromEntries((ps ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name])));
      }
    });
  }, [club.id]);
  if (!rows) return <Loading />;
  return (
    <div className="panel grid-wrap">
      <p className="small muted" style={{ marginTop: 0 }}>Every override and money decision, with who did it and why.</p>
      <table className="t">
        <tbody>
          {rows.map((r) => {
            const why = (r.details.note ?? r.details.reason) as string | undefined;
            return (
              <tr key={r.id}>
                <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</td>
                <td>{r.actor ? names[r.actor] ?? 'Staff' : 'System'}</td>
                <td>{ACTION[r.action] ?? r.action}{why && <div className="small muted">“{why}”</div>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
