'use client';
import { useCallback, useEffect, useState } from 'react';
import { loadTickets, supportApi, type Ticket } from '@/lib/admin';
import { Band, Empty, Loading, useToast } from '@/components/Shell';

const KIND: Record<string, string> = { bug: 'Problem', question: 'Question', feature: 'Idea', other: 'Other' };

// Members' problems and questions. A reply is sent to the member as a notification.
export default function AdminFeedback() {
  const toast = useToast();
  const [list, setList] = useState<Ticket[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [showDone, setShowDone] = useState(false);
  const load = useCallback(() => { loadTickets().then(setList).catch((e) => { toast((e as Error).message, true); setList([]); }); }, [toast]);
  useEffect(() => { load(); }, [load]);
  async function update(id: string, body: Record<string, unknown>, ok: string) {
    try { await supportApi('admin-update', 'PATCH', { ticket_id: id, ...body }); toast(ok); load(); }
    catch (e) { toast((e as Error).message, true); }
  }
  if (!list) return <Loading />;
  const open = list.filter((t) => t.status !== 'resolved'), done = list.filter((t) => t.status === 'resolved');
  const shown = showDone ? done.slice(0, 20) : open;
  return (
    <>
      <Band back={{ href: '/admin/', label: 'Admin' }}>
        <h1 className="h1" style={{ marginTop: 4 }}>Feedback</h1>
        <div className="seg" style={{ marginTop: 14 }}>
          <button className={!showDone ? 'on' : ''} onClick={() => setShowDone(false)}>To answer ({open.length})</button>
          <button className={showDone ? 'on' : ''} onClick={() => setShowDone(true)}>Resolved</button>
        </div>
      </Band>
      <div className="section stack">
        {shown.length === 0 && <Empty title={showDone ? 'Nothing resolved yet' : 'All answered'} />}
        {shown.map((t) => (
          <div key={t.id} className="card stack">
            <div className="between"><b>{KIND[t.kind] ?? t.kind}, {t.submitter_name ?? 'Member'}</b><span className={'tag ' + (t.status === 'resolved' ? 'ok' : t.status === 'reviewing' ? 'wait' : 'off')}>{t.status === 'resolved' ? 'Resolved' : t.status === 'reviewing' ? 'Checking' : 'Open'}</span></div>
            <div className="small muted">{new Date(t.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            <p style={{ whiteSpace: 'pre-line' }}>{t.description}</p>
            {t.screenshot_url && <a href={t.screenshot_url} target="_blank" rel="noreferrer"><img src={t.screenshot_url} alt="Screenshot from the member" style={{ maxWidth: 140, borderRadius: 10, border: '1px solid var(--line)' }} /></a>}
            {t.admin_reply && <p className="small"><b>Your reply:</b> {t.admin_reply}</p>}
            <textarea className="input" rows={2} placeholder="Reply (the member gets a notification)" value={draft[t.id] ?? ''} onChange={(e) => setDraft({ ...draft, [t.id]: e.target.value })} />
            <div className="btn-row">
              <button className="btn sm pink" disabled={!(draft[t.id] ?? '').trim()} onClick={() => update(t.id, { admin_reply: draft[t.id].trim() }, 'Reply sent')}>Send reply</button>
              {t.status !== 'resolved'
                ? <button className="btn sm green" onClick={() => update(t.id, { status: 'resolved' }, 'Marked resolved')}>Resolved</button>
                : <button className="btn sm ghost" onClick={() => update(t.id, { status: 'open' }, 'Reopened')}>Reopen</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
