'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminBand, AdminOnly } from '@/components/AdminBits';
import { Loading, useToast } from '@/components/Shell';
import { Icon } from '@/components/Icon';
import { dayHeading, fmtClock, fmtDate, manilaToday } from '@/lib/format';
import { isDraft, loadAdminSessions, loadCounts, type AdminSess, type Counts } from '@/lib/admin';

export default function Sessions() {
  return <AdminOnly><SessionsInner /></AdminOnly>;
}

function Row({ s, c }: { s: AdminSess; c?: Counts }) {
  const h = dayHeading(s.session_date);
  return (
    <Link href={'/admin/session/?id=' + s.id} className="srow">
      <div>
        <div className="small muted" style={{ fontWeight: 700 }}>{s.session_date >= manilaToday() ? h.title : fmtDate(s.session_date)}, {fmtClock(s.time_start)} to {fmtClock(s.time_end)}</div>
        <div className="ttl">{s.label}</div>
        <div className="meta">{s.venue}</div>
      </div>
      <div className="price"><div className="num">{c?.total ?? 0}<small className="muted" style={{ fontSize: 13 }}>/{s.max_players}</small></div></div>
      <div className="tags">
        {isDraft(s) && <span className="tag wait">Draft</span>}
        {s.is_cancelled && <span className="tag off">Cancelled</span>}
        {s.session_type === 'coaching' && <span className="tag">Training</span>}
        {!!c?.paid && <span className="tag ok">{c.paid} paid</span>}
        {!!c?.pending && <span className="tag wait">{c.pending} checking</span>}
        {!!c?.waitlisted && <span className="tag off">{c.waitlisted} waiting</span>}
      </div>
    </Link>
  );
}

function SessionsInner() {
  const toast = useToast();
  const [list, setList] = useState<AdminSess[] | null>(null);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [past, setPast] = useState(false);
  useEffect(() => {
    Promise.all([loadAdminSessions(), loadCounts()]).then(([l, c]) => { setList(l); setCounts(c); }).catch((e) => toast((e as Error).message, true));
  }, [toast]);

  if (!list) return <><AdminBand title="Sessions" /><Loading /></>;
  const today = manilaToday();
  const sort = (a: AdminSess, b: AdminSess) => (a.session_date + a.time_start).localeCompare(b.session_date + b.time_start);
  const drafts = list.filter(isDraft).sort(sort);
  const upcoming = list.filter((s) => s.published_at && !s.is_cancelled && s.session_date >= today).sort(sort);
  const done = list.filter((s) => s.session_date < today && !isDraft(s)).sort((a, b) => sort(b, a));

  return (
    <>
      <AdminBand title="Sessions" sub="Open play and training. Tap one for its players.">
        <Link className="btn pink" style={{ marginTop: 16 }} href="/admin/edit/"><Icon name="plus" />New session</Link>
      </AdminBand>

      {drafts.length > 0 && (
        <div className="section" id="drafts" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <div className="section-head pad"><span className="h3">Drafts</span><span className="small muted">Members can&apos;t see these yet</span></div>
          {drafts.map((s) => <Row key={s.id} s={s} c={counts[s.id]} />)}
        </div>
      )}

      <div className="section" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div className="section-head pad"><span className="h3">Coming up</span></div>
        {upcoming.length === 0 && <div className="card sub" style={{ margin: '0 16px' }}>Nothing published yet.</div>}
        {upcoming.map((s) => <Row key={s.id} s={s} c={counts[s.id]} />)}
      </div>

      <div className="section" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <button className="section-head pad" style={{ width: '100%' }} onClick={() => setPast(!past)}>
          <span className="h3">Last two weeks</span><span className="link">{past ? 'Hide' : `Show ${done.length}`}</span>
        </button>
        {past && done.map((s) => <Row key={s.id} s={s} c={counts[s.id]} />)}
      </div>
      <div style={{ height: 24 }} />
    </>
  );
}
