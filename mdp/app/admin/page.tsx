'use client';
import Link from 'next/link';
import { CLASSIC_URL } from '@/lib/classic';
import { useEffect, useState } from 'react';
import { AdminBand, AdminOnly } from '@/components/AdminBits';
import { Loading } from '@/components/Shell';
import { Icon } from '@/components/Icon';
import { dayHeading, fmtClock, manilaToday, peso } from '@/lib/format';
import { isDraft, loadAdminSessions, loadCounts, loadOverpaid, loadTickets, loadTopups, type AdminSess, type Counts, type Overpay, type Ticket, type Topup } from '@/lib/admin';

interface Data { sessions: AdminSess[]; counts: Record<string, Counts>; topups: Topup[]; over: Overpay[]; tickets: Ticket[] }

export default function AdminToday() {
  return <AdminOnly><Today /></AdminOnly>;
}

function Today() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    Promise.all([
      loadAdminSessions(), loadCounts(),
      loadTopups().catch(() => [] as Topup[]), loadOverpaid().catch(() => [] as Overpay[]), loadTickets().catch(() => [] as Ticket[]),
    ]).then(([sessions, counts, topups, over, tickets]) => setD({ sessions, counts, topups, over, tickets })).catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return <><AdminBand title="Today" /><div className="section"><div className="err">{err}</div></div></>;
  if (!d) return <><AdminBand title="Today" /><Loading /></>;

  const today = manilaToday();
  const live = d.sessions.filter((s) => !s.is_cancelled);
  const liveIds = new Set(live.map((s) => s.id));
  const checks = Object.entries(d.counts).filter(([sid]) => liveIds.has(sid)).flatMap(([, c]) => c.players)
    .filter((p) => p.status === 'pending' && !p.paid_by_reg_id && (p.proof_url || p.gcash_ref)).length
    + d.topups.filter((t) => t.status === 'pending' && t.proof_url).length;
  const open = d.tickets.filter((t) => t.status !== 'resolved').length;
  const drafts = live.filter(isDraft);
  const soon = live.filter((s) => s.published_at && s.session_date >= today).sort((a, b) => (a.session_date + a.time_start).localeCompare(b.session_date + b.time_start)).slice(0, 6);
  const owed = d.over.reduce((n, o) => n + Number(o.excess), 0);
  const all = checks + d.over.length + open + drafts.length;

  return (
    <>
      <AdminBand title="Today" sub={all === 0 ? 'Nothing needs you right now.' : `${all} thing${all === 1 ? '' : 's'} need${all === 1 ? 's' : ''} you.`} badges={{ Payments: checks + d.over.length }} />

      <div className="section">
        <Link href="/admin/payments/" className={'todo' + (checks ? '' : ' calm')}>
          <span className="n">{checks}</span>
          <span><div className="t">{checks === 1 ? 'Payment to check' : 'Payments to check'}</div><div className="d">{checks ? 'Receipts the AI check couldn\'t approve on its own' : 'Every receipt has been checked'}</div></span>
          <Icon name="chev" className="chev" />
        </Link>
        {d.over.length > 0 && (
          <Link href="/admin/payments/#overpaid" className="todo">
            <span className="n">{d.over.length}</span>
            <span><div className="t">Paid too much</div><div className="d">{peso(owed)} to add to members&apos; wallets</div></span>
            <Icon name="chev" className="chev" />
          </Link>
        )}
        {drafts.length > 0 && (
          <Link href="/admin/sessions/#drafts" className="todo">
            <span className="n">{drafts.length}</span>
            <span><div className="t">{drafts.length === 1 ? 'Draft not published' : 'Drafts not published'}</div><div className="d">{drafts.map((s) => s.label).slice(0, 2).join(', ')}{drafts.length > 2 ? '…' : ''}</div></span>
            <Icon name="chev" className="chev" />
          </Link>
        )}
        {open > 0 && (
          <Link href="/admin/feedback/" className="todo">
            <span className="n">{open}</span>
            <span><div className="t">Feedback to answer</div><div className="d">Problems and questions from members</div></span>
            <Icon name="chev" className="chev" />
          </Link>
        )}
      </div>

      <div className="section">
        <div className="section-head"><span className="h3">Coming up</span><Link className="link" href="/admin/edit/">New session</Link></div>
        {soon.length === 0 && <div className="card sub">No published sessions coming up.</div>}
        {soon.map((s) => {
          const c = d.counts[s.id] ?? { total: 0, paid: 0, pending: 0, waitlisted: 0, players: [] };
          const h = dayHeading(s.session_date);
          const isToday = s.session_date === today;
          return (
            <div key={s.id} className="card" style={{ marginBottom: 10 }}>
              <Link href={'/admin/session/?id=' + s.id} style={{ display: 'block' }}>
                <div className="between"><span className="small muted" style={{ fontWeight: 700 }}>{h.title}, {fmtClock(s.time_start)}</span><span className="num" style={{ fontWeight: 800 }}>{c.total}/{s.max_players}</span></div>
                <div className="h3" style={{ marginTop: 2 }}>{s.label}</div>
                <div className="small muted">{s.venue}</div>
                <div className="counts">
                  <span className="tag ok">{c.paid} paid</span>
                  {c.pending > 0 && <span className="tag wait">{c.pending} checking</span>}
                  {c.waitlisted > 0 && <span className="tag off">{c.waitlisted} waiting</span>}
                  {s.session_type === 'coaching' && <span className="tag">Training</span>}
                </div>
              </Link>
              {isToday && <Link className="btn navy sm" style={{ marginTop: 12, width: '100%' }} href={'/courts/?s=' + s.id}><Icon name="court" />Run the courts</Link>}
            </div>
          );
        })}
        <Link className="link" href="/admin/sessions/">All sessions</Link>
      </div>

      <div className="section">
        <div className="section-head"><span className="h3">More tools</span></div>
        <div className="list">
          <Link href="/admin/members/"><Icon name="users" /><span className="grow">Members and tiers</span><Icon name="chev" className="chev" /></Link>
          <Link href="/admin/feedback/"><Icon name="bell" /><span className="grow">Feedback</span><Icon name="chev" className="chev" /></Link>
          <a href={CLASSIC_URL + '/#admin'} target="_blank" rel="noopener"><Icon name="link" /><span className="grow">Coaching, financials, venues<br /><span className="small muted">In the classic app for now. Same login.</span></span><Icon name="chev" className="chev" /></a>
        </div>
      </div>
      <div style={{ height: 24 }} />
    </>
  );
}
