'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMe } from '@/lib/me';
import { rpc } from '@/lib/supabase';
import { fmtClock, fmtDate, initials, manilaToday, peso } from '@/lib/format';
import { isDuprNight, loadHosts, loadLeadHours, loadMyRegs, loadMyRequests, loadRoster, loadSessions, spotsLeft, type Reg, type RosterRow, type Sess } from '@/lib/sessions';
import { Band, Empty, Loading, Sheet, useToast } from '@/components/Shell';
import { SessionTags, sessionCta, useCtaAction } from '@/components/SessionBits';
import { Icon } from '@/components/Icon';

export default function SessionPage() {
  const toast = useToast();
  const { userId, profile, ready } = useMe();
  const [s, setS] = useState<Sess | null | undefined>(undefined);
  const [hosts, setHosts] = useState<Record<string, string>>({});
  const [regs, setRegs] = useState<Reg[]>([]);
  const [reqs, setReqs] = useState<Record<string, string>>({});
  const [lead, setLead] = useState<Record<string, number>>({});
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('id');
    loadSessions().then((l) => setS(l.find((x) => x.id === id) ?? null)).catch(() => setS(null));
    loadHosts().then(setHosts);
    loadLeadHours().then(setLead);
  }, []);
  useEffect(() => {
    if (!userId) return;
    loadMyRegs().then(setRegs).catch(() => {});
    loadMyRequests().then(setReqs);
  }, [userId]);
  useEffect(() => { if (s && userId) loadRoster(s.id).then(setRoster).catch(() => setRoster([])); }, [s, userId]);
  const act = useCtaAction(() => setAsking(true), toast, profile);

  if (s === undefined) return <Loading />;
  if (s === null) return <Empty title="This session isn't listed any more"><Link className="link" href="/">See all sessions</Link></Empty>;

  const host = s.organizer_id ? hosts[s.organizer_id] ?? 'a partner host' : null;
  const cta = sessionCta(s, { userId, profile, regs, reqs, lead });
  const dupr = isDuprNight(s);
  const isToday = s.session_date === manilaToday();
  const players = (roster ?? []).flatMap((p) => {
    const out = [{ key: p.id, name: p.player_name, sub: '', rating: p.dupr_doubles ?? p.dupr_singles, guest: false }];
    if (p.guest_name) out.push({ key: p.id + 'g', name: p.guest_name, sub: `Guest of ${p.player_name.split(' ')[0]}`, rating: null, guest: true });
    return out;
  }).sort((a, b) => Number(b.rating ?? -1) - Number(a.rating ?? -1));

  async function sendRequest() {
    setBusy(true);
    try {
      await rpc('request_to_join', { p_session: s!.id, p_note: note });
      setReqs((r) => ({ ...r, [s!.id]: 'waiting' })); setAsking(false); setNote('');
      toast('Request sent. You\'ll get a notification when the host replies.');
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  return (
    <div className="has-cta">
      <Band back={{ href: '/', label: 'Sessions' }}>
        <SessionTags s={s} host={host ?? undefined} courts={false} />
        <h1 className="h1" style={{ marginTop: 10 }}>{s.label}</h1>
        <p className="sub" style={{ marginTop: 6 }}>{fmtDate(s.session_date)}, {fmtClock(s.time_start)} to {fmtClock(s.time_end)}</p>
        <div className="facts">
          <div><div className="k">Fee</div><div className="v num">{peso(s.fee)}</div></div>
          <div><div className="k">Spots left</div><div className="v num">{spotsLeft(s)}<small> of {s.max_players}</small></div></div>
          <div><div className="k">Courts</div><div className="v num">{s.courts ?? '–'}</div></div>
        </div>
      </Band>

      <div className="section stack">
        <div className="info-list">
          <div><Icon name="pin" /><div><b>{s.venue}</b>{!!s.venue_fee && <div className="muted small">Plus {peso(s.venue_fee)} venue entrance, paid at the door</div>}</div></div>
          {dupr && <div><Icon name="shield" /><div><b>Every game counts for DUPR</b><div className="muted small">Scores are entered on the court board and sent to DUPR after the night. Link your DUPR account in Me.</div></div></div>}
          <div><Icon name="court" /><div><b>The app runs the courts</b><div className="muted small">Tap I&apos;m here when you arrive. You&apos;re grouped by level and called to a court when it&apos;s your turn.</div></div></div>
          {s.requires_approval && <div><Icon name="users" /><div><b>{host ?? 'The host'} approves players first</b><div className="muted small">Ask to join. You only pay once you&apos;re approved.</div></div></div>}
          {s.venue_proof_path && <div><Icon name="check" /><div><b>Court booking checked</b><div className="muted small">The host&apos;s court reservation is on file with MDP.</div></div></div>}
        </div>
        {s.notes && <div className="note">{s.notes}</div>}
        {isToday && cta.kind === 'mine' && <Link className="btn navy" href={'/courts/?s=' + s.id}><Icon name="court" />Open the court board</Link>}
      </div>

      <div className="section">
        <div className="section-head"><span className="h3">Who&apos;s playing</span><span className="sub">{s.seats_used} booked{s.waitlist_count ? `, ${s.waitlist_count} waiting` : ''}</span></div>
        {!userId ? <div className="card sub"><Link className="link" href={'/login/?next=' + encodeURIComponent('/s/?id=' + s.id)}>Sign in</Link> to see who&apos;s playing.</div>
          : !roster ? <Loading rows={2} />
          : players.length === 0 ? <div className="card sub">No one yet. Be the first.</div>
          : <div className="roster">{players.map((p) => (
              <div key={p.key} className="prow">
                <span className={'ini' + (p.guest ? ' guest' : '')}>{initials(p.name)}</span>
                <span className="nm">{p.name}{p.sub && <small>{p.sub}</small>}</span>
                {p.rating ? <span className="rating">{Number(p.rating).toFixed(2)}</span> : <span className="rating nr">No rating</span>}
              </div>
            ))}</div>}
      </div>

      {ready && (
        <div className="sticky-cta">
          {cta.kind === 'blocked' && cta.hint && <div className="hint">{cta.hint}</div>}
          <button className={'btn ' + (cta.kind === 'mine' ? 'green' : cta.kind === 'blocked' ? 'quiet' : 'pink')} disabled={cta.kind === 'blocked' && !cta.hint} onClick={() => act(s, cta)}>
            {cta.kind === 'mine' && <Icon name="check" />}{cta.label}{cta.kind === 'mine' ? ', see booking' : ''}
          </button>
        </div>
      )}

      {asking && (
        <Sheet title="Ask to join" onClose={() => setAsking(false)}>
          <p className="sub" style={{ marginBottom: 14 }}><b style={{ color: 'var(--text)' }}>{host ?? 'The host'}</b> checks players first for {s.label}. You don&apos;t pay anything yet. If you&apos;re approved, you&apos;ll get a notification and pay {peso(s.fee)} in the app.</p>
          <label className="field"><span>Your level, for the host (optional)</span>
            <textarea className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: about 3.0, I play Fridays with Paolo." />
          </label>
          <button className="btn pink" disabled={busy} onClick={sendRequest}>{busy ? 'Sending…' : 'Send request'}</button>
        </Sheet>
      )}
    </div>
  );
}
