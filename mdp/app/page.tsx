'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMe, profileProblem } from '@/lib/me';
import { rpc } from '@/lib/supabase';
import { dateParts, fmtClock, peso } from '@/lib/format';
import { activeReg, loadHosts, loadLeadHours, loadMyRegs, loadMyRequests, loadRoster, loadSessions, opensAt, type Reg, type RosterRow, type Sess } from '@/lib/sessions';
import { Loading, Sheet, useToast } from '@/components/Shell';

export default function Home() {
  const router = useRouter();
  const toast = useToast();
  const { userId, profile, ready } = useMe();
  const [sessions, setSessions] = useState<Sess[] | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [hosts, setHosts] = useState<Record<string, string>>({});
  const [regs, setRegs] = useState<Reg[]>([]);
  const [reqs, setReqs] = useState<Record<string, string>>({});
  const [lead, setLead] = useState<Record<string, number>>({});
  const [roster, setRoster] = useState<Record<string, RosterRow[]>>({});
  const [asking, setAsking] = useState<Sess | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSessions().then((l) => {
      setSessions(l);
      const linked = typeof window !== 'undefined' ? new URLSearchParams(location.search).get('s') : null;
      setActive(linked && l.some((x) => x.id === linked) ? linked : l[0]?.id ?? null);
    }).catch((e) => setError(e.message));
    loadHosts().then(setHosts);
    loadLeadHours().then(setLead);
  }, []);
  useEffect(() => {
    if (!userId) { setRegs([]); setReqs({}); return; }
    loadMyRegs().then(setRegs).catch(() => {});
    loadMyRequests().then(setReqs);
  }, [userId]);
  useEffect(() => {
    if (!active || !userId || roster[active]) return;
    loadRoster(active).then((r) => setRoster((m) => ({ ...m, [active]: r }))).catch(() => {});
  }, [active, userId, roster]);

  const s = useMemo(() => sessions?.find((x) => x.id === active) ?? null, [sessions, active]);

  async function sendRequest() {
    if (!asking) return;
    setBusy(true);
    try {
      await rpc('request_to_join', { p_session: asking.id, p_note: note });
      setReqs((r) => ({ ...r, [asking.id]: 'waiting' })); setAsking(null); setNote('');
      toast('✓ Request sent. You\'ll get a notification when the host replies.');
    } catch (e) { toast('⚠️ ' + (e as Error).message, true); }
    setBusy(false);
  }

  function cta(x: Sess) {
    const color = dateParts(x.session_date).weekend ? 'p' : 'g';
    const full = x.seats_used >= x.max_players;
    const mine = activeReg(regs, x.id);
    if (mine) {
      const lbl = mine.status === 'paid' ? "✓ You're in · view slot" : mine.status === 'invited' ? '📩 Approved · confirm and pay' : mine.status === 'waitlisted' ? '📋 On waitlist · view slot' : '⏳ Pending · view slot';
      return <Link className="jbtn g" style={{ display: 'block', textAlign: 'center' }} href="/slots/">{lbl}</Link>;
    }
    if (x.requires_approval && reqs[x.id] === 'waiting') return <button className="jbtn g" onClick={() => toast('Your request is with the host. You\'ll get a notification when they reply.')}>⏳ Request sent · waiting for the host</button>;
    if (x.requires_approval && reqs[x.id] === 'declined') return <button className="jbtn full" disabled>The host couldn&apos;t take you this time</button>;
    const t = opensAt(x, profile, lead);
    if (userId && (t === null || t > Date.now())) {
      const when = t ? new Date(t).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'soon';
      return <button className="jbtn full" disabled>🔒 Registration opens {when}</button>;
    }
    if (full) return <button className="jbtn full" disabled>🔒 Session full</button>;
    const go = () => {
      if (!userId) { router.push('/login/?next=' + encodeURIComponent('/?s=' + x.id)); return; }
      const why = profileProblem(profile); if (why) { toast('⚠️ ' + why, true); return; }
      if (x.requires_approval) { setAsking(x); return; }
      router.push('/book/?s=' + x.id);
    };
    return <button className={'jbtn ' + color} onClick={go}>{x.requires_approval ? '🙋  REQUEST TO JOIN' : `🏓  JOIN · ${peso(x.fee)}`}</button>;
  }

  return (
    <>
      <div className="hero">
        <div className="big-title">Reserve your<br /><em>SPOT ON COURT.</em></div>
        <div className="pg-sub">Pick a session, see who&apos;s playing, and book and pay right here.</div>
      </div>
      {error && <div className="empty2" style={{ color: 'var(--pk)' }}>{error}</div>}
      {!sessions && !error && <Loading text="Loading sessions…" />}
      {sessions && sessions.length === 0 && <div className="empty2">No upcoming sessions yet.</div>}
      {sessions && sessions.length > 0 && (
        <div className="stabs" style={{ top: 0 }}>
          {sessions.map((x) => <button key={x.id} className={'stab' + (x.id === active ? ' active' : '')} onClick={() => setActive(x.id)}>{dateParts(x.session_date).tab}</button>)}
        </div>
      )}
      {s && (() => {
        const dp = dateParts(s.session_date), color = dp.weekend ? 'p' : 'g';
        const left = Math.max(0, s.max_players - s.seats_used), pct = Math.min(100, Math.round((s.seats_used / Math.max(1, s.max_players)) * 100));
        const rows = (roster[s.id] ?? []).slice().sort((a, b) => Number(b.dupr_doubles ?? b.dupr_singles ?? 0) - Number(a.dupr_doubles ?? a.dupr_singles ?? 0));
        let n = 0;
        return (
          <div className="spanel active">
            <div className="scard">
              <div className={'dblk ' + color}><div className="d-mon">{dp.mon}</div><div className="d-day">{dp.day}</div></div>
              <div>
                <div className="sc-ttl">{s.label}</div>
                <div className="sc-venue">📍 {s.venue}</div>
                {s.organizer_id && <div className="sc-venue" style={{ color: 'var(--go)', fontWeight: 700 }}>🤝 Hosted by {hosts[s.organizer_id] ?? 'a partner host'}</div>}
                {s.requires_approval && <div className="sc-venue">🛡 The host approves players first. You pay after you&apos;re approved.</div>}
                {s.venue_proof_path && <div className="sc-venue" style={{ color: 'var(--gr)', fontWeight: 700 }}>✓ Court booking proof on file</div>}
                <div className="sc-time">⏰ {fmtClock(s.time_start)} – {fmtClock(s.time_end)}{s.courts ? ` · 🎾 ${s.courts} court${s.courts === 1 ? '' : 's'}` : ''} · {peso(s.fee)}</div>
                {s.notes && <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--go)', marginTop: 4, whiteSpace: 'pre-line' }}>{s.notes}</div>}
              </div>
            </div>
            {!!s.venue_fee && <div className="sat-notice"><span>⚠️</span><span>+ <strong>₱{s.venue_fee} venue entrance</strong> payable at the door</span></div>}
            <div className="slots-row"><span className="slots-lbl">Availability</span><span className={'slots-val' + (left === 0 ? ' danger' : left <= 4 ? ' warn' : '')}>{s.seats_used} / {s.max_players}</span></div>
            <div className="prog"><div className={'pf' + (left === 0 ? ' danger' : left <= 4 ? ' warn' : '')} style={{ width: pct + '%' }} /></div>
            {ready && cta(s)}
            {userId ? (
              <>
                <div style={{ marginBottom: 10 }}><span className="slbl">Registered Players</span></div>
                <div className="rost">
                  {!roster[s.id] ? <div className="loading-msg">Loading…</div> : rows.length === 0 ? <div className="empty">No players yet.</div> : rows.map((p) => {
                    const chip = p.dupr_doubles ? <span className="dupr-inline-chip"><span className="k">D</span>{Number(p.dupr_doubles).toFixed(2)}</span> : p.dupr_singles ? <span className="dupr-inline-chip"><span className="k">S</span>{Number(p.dupr_singles).toFixed(2)}</span> : null;
                    const out = [<div key={p.id} className="prow"><div className="pnum">{++n}</div><div className="pname">{p.player_name}{chip}</div><div className="pdot paid" /></div>];
                    if (p.guest_name) out.push(<div key={p.id + 'g'} className="prow" style={{ background: 'rgba(224,53,122,.04)' }}><div className="pnum">{++n}</div><div className="pname">{p.guest_name} <span style={{ fontSize: 10, color: 'var(--pk)', fontWeight: 700, marginLeft: 4 }}>GUEST of {p.player_name}</span></div><div className="pdot paid" /></div>);
                    return out;
                  })}
                </div>
                <div className="legend"><div className="leg"><div className="leg-dot" style={{ background: 'var(--gr)' }} />Spot taken</div></div>
              </>
            ) : <div className="empty2"><Link href="/login/" style={{ color: 'var(--pk)', fontWeight: 800 }}>Sign in</Link> to see who&apos;s playing.</div>}
          </div>
        );
      })()}
      {asking && (
        <Sheet title="🙋 Request to join" onClose={() => setAsking(null)}>
          <p style={{ fontSize: 13, color: 'var(--cr)', lineHeight: 1.5 }}><b>{asking.organizer_id ? hosts[asking.organizer_id] ?? 'The host' : 'The host'}</b> checks players first for <b>{asking.label}</b>. You don&apos;t pay anything yet. If you&apos;re approved, you&apos;ll get a notification and pay {peso(asking.fee)} in the app.</p>
          <label className="flbl">Your level, for the host (optional)</label>
          <textarea className="finp" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Intermediate, about 3.0. I play Fridays with Paolo." style={{ marginBottom: 12, fontFamily: 'inherit' }} />
          <button className="btn btn-g" disabled={busy} onClick={sendRequest}>{busy ? 'Sending…' : 'Send request'}</button>
        </Sheet>
      )}
    </>
  );
}
