'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { dateParts, dow, fmtClock } from '@/lib/format';
import type { Reg } from '@/lib/sessions';
import { REG_LABEL } from './SessionBits';

/** A booking drawn as a match-day pass: date stub on the left, colour by status. */
export function Ticket({ r, href, children, extra }: { r: Reg; href?: string; children?: ReactNode; extra?: ReactNode }) {
  const s = r.sessions!;
  const dp = dateParts(s.session_date);
  const off = r.status === 'cancelled' || r.status === 'rejected' || s.is_cancelled;
  const cls = off ? 'off' : r.status === 'paid' ? 'paid' : 'pending';
  const st = off ? { text: s.is_cancelled ? 'Session cancelled' : r.status === 'rejected' ? 'Not accepted' : 'Cancelled', cls: 'off' }
    : r.status === 'pending' && r.ai_check_status === 'flagged' ? { text: 'Receipt with MDP for review', cls: 'wait' }
    : r.status === 'pending' && !r.proof_url ? { text: 'Waiting for payment', cls: 'wait' }
    : REG_LABEL[r.status] ?? { text: r.status, cls: 'off' };
  const inner = (
    <div className="body">
      <div className="ttl">{s.label}</div>
      <div className="meta">{fmtClock(s.time_start)} to {fmtClock(s.time_end)}, {s.venue}</div>
      {r.guest_name && <div className="meta">With your guest {r.guest_name}</div>}
      <div className="foot"><span className={'tag ' + st.cls}>{st.text}</span>{extra}</div>
    </div>
  );
  return (
    <div className={'ticket ' + cls}>
      <div className="stub"><span className="dow">{dow(s.session_date)}</span><span className="day">{dp.day}</span><span className="mon">{dp.mon}</span></div>
      {href ? <Link href={href}>{inner}</Link> : inner}
      {children && <div className="actions">{children}</div>}
    </div>
  );
}
