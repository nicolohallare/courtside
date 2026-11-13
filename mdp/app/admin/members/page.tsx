'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { fmtDate, peso, rating } from '@/lib/format';
import { Band, Empty, Loading, Sheet, useToast } from '@/components/Shell';
import { ConductLog, reasonLabel } from '@/components/Conduct';

interface M {
  id: string; full_name: string | null; email: string | null; phone: string | null; tier: string; joined: string;
  last_played: string | null; games_90d: number; games_all: number; dupr: number | null; wallet: number;
  blocked: boolean; blocked_note: string | null; tier_changed_at: string | null; is_admin: boolean;
}

// One place for who books when. The windows are the club's standard (Nov 11): the same for every session.
const TIERS = [
  { k: 'varsity', label: 'Varsity', when: 'Books 2 weeks before' },
  { k: 'member', label: 'Member', when: 'Books 5 days before' },
  { k: 'community', label: 'Community', when: 'Books 3 days before. New sign-ups start here' },
  { k: 'flagged', label: 'Flagged', when: 'Books 1 hour before, no guests' },
] as const;
const tierLabel = (k: string) => TIERS.find((t) => t.k === k)?.label ?? k;
const READY = 3; // paid games before a Community player is suggested for Member

export default function AdminMembers() {
  const toast = useToast();
  const { profile } = useMe();
  const [list, setList] = useState<M[] | null>(null);
  const [tab, setTab] = useState<string>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<M | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [alerts, setAlerts] = useState<{ id: string; full_name: string; people: number; reasons: string[]; last_flag: string }[]>([]);
  const [flagCounts, setFlagCounts] = useState<Record<string, number>>({});
  const loadConduct = () => {
    rpc<typeof alerts>('admin_conduct_alerts').then(setAlerts).catch(() => setAlerts([]));
    rpc<{ id: string; people: number }[]>('admin_conduct_counts').then((l) => setFlagCounts(Object.fromEntries(l.map((x) => [x.id, x.people])))).catch(() => {});
  };
  useEffect(() => { loadConduct(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(() => rpc<M[]>('admin_members').then(setList).catch((e) => { toast((e as Error).message, true); setList([]); }), [toast]);
  useEffect(() => { load(); }, [load]);

  const ready = useMemo(() => (list ?? []).filter((m) => m.tier === 'community' && m.games_all >= READY && !m.blocked), [list]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list ?? []).filter((m) => (tab === 'all' || (tab === 'blocked' ? m.blocked : m.tier === tab))
      && (!s || `${m.full_name ?? ''} ${m.email ?? ''} ${m.phone ?? ''}`.toLowerCase().includes(s)))
      .sort((a, b) => (b.last_played ?? '').localeCompare(a.last_played ?? '') || (a.full_name ?? '').localeCompare(b.full_name ?? ''));
  }, [list, tab, q]);

  async function setTier(m: M, tier: string, quiet = false) {
    if (m.tier === tier) return;
    try {
      await rpc('set_access_tier', { p_member: m.id, p_tier: tier });
      setList((l) => l?.map((x) => (x.id === m.id ? { ...x, tier } : x)) ?? null);
      setOpen((o) => (o && o.id === m.id ? { ...o, tier } : o));
      if (!quiet) toast(`${m.full_name ?? 'Member'} is now ${tierLabel(tier)}`);
    } catch (e) { toast((e as Error).message, true); }
  }
  async function promoteAll() {
    setBusy(true);
    for (const m of ready) await setTier(m, 'member', true);
    toast(`${ready.length} players moved to Member`); setBusy(false);
  }
  async function setBlocked(m: M, on: boolean) {
    setBusy(true);
    try {
      await rpc('set_booking_blocked', { p_member: m.id, p_blocked: on, p_note: on ? note.trim() || null : null });
      toast(on ? `${m.full_name} can't book until you unblock them` : `${m.full_name} can book again`);
      setOpen(null); setNote(''); load();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  if (!list) return <Loading />;
  const count = (k: string) => list.filter((m) => (k === 'blocked' ? m.blocked : m.tier === k)).length;
  const played = (m: M) => m.games_all === 0 ? 'Hasn\'t played yet' : `${m.games_all} game${m.games_all === 1 ? '' : 's'}${m.last_played ? `, last ${fmtDate(m.last_played)}` : ''}`;

  return (
    <>
      <Band back={{ href: '/admin/', label: 'Admin' }}>
        <h1 className="h1" style={{ marginTop: 4 }}>Members</h1>
        <p className="sub" style={{ marginTop: 6 }}>{list.length} players. Tap a name to change their tier.</p>
      </Band>

      {alerts.length > 0 && !q && (
        <div className="section" style={{ paddingBottom: 0 }}>
          <div className="card stack" style={{ borderColor: 'var(--warn)' }}>
            <div className="between"><b>Flagged by 3 or more players</b><span className="tag wait">{alerts.length}</span></div>
            <p className="small muted">Different players flagged them in the last 60 days. Open their log, talk to them, then add what you did.</p>
            {alerts.map((a) => {
              const m = list?.find((x) => x.id === a.id);
              return (
                <div key={a.id} className="between">
                  <div><div style={{ fontWeight: 700 }}>{a.full_name}</div><div className="small muted">{a.people} players: {a.reasons.map((r) => reasonLabel(r).toLowerCase()).join('; ')}</div></div>
                  {m && <button className="btn sm ghost inline" onClick={() => { setOpen(m); setNote(''); }}>Open</button>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ready.length > 0 && (tab === 'all' || tab === 'community') && !q && (
        <div className="section">
          <div className="card stack">
            <div className="between"><b>Regulars still in Community</b><span className="tag wait">{ready.length}</span></div>
            <p className="small muted">Played {READY} or more times. Members book 2 days earlier than Community.</p>
            {ready.slice(0, 6).map((m) => (
              <div key={m.id} className="between">
                <div><div style={{ fontWeight: 700 }}>{m.full_name}</div><div className="small muted">{played(m)}</div></div>
                <button className="btn sm green inline" onClick={() => setTier(m, 'member')}>Make Member</button>
              </div>
            ))}
            {ready.length > 1 && <button className="btn sm ghost" disabled={busy} onClick={promoteAll}>{busy ? 'Moving…' : `Make all ${ready.length} Members`}</button>}
          </div>
        </div>
      )}

      <div className="section">
        <div className="chips" style={{ marginBottom: 12 }}>
          <button className={'chip' + (tab === 'all' ? ' on' : '')} onClick={() => setTab('all')}>All</button>
          {TIERS.map((t) => <button key={t.k} className={'chip' + (tab === t.k ? ' on' : '')} onClick={() => setTab(t.k)}>{t.label} {count(t.k)}</button>)}
          {count('blocked') > 0 && <button className={'chip' + (tab === 'blocked' ? ' on' : '')} onClick={() => setTab('blocked')}>Blocked {count('blocked')}</button>}
        </div>
        <input className="input" placeholder="Search name, email or mobile" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
        {shown.length === 0 ? <Empty title="No one here" /> : (
          <div className="list">
            {shown.slice(0, 150).map((m) => (
              <button key={m.id} onClick={() => { setOpen(m); setNote(''); }} style={{ width: '100%', textAlign: 'left' }}>
                <span className="grow"><b>{m.full_name || m.email}</b>{m.is_admin && <span className="tag" style={{ marginLeft: 6 }}>Admin</span>}<br />
                  <span className="small muted">{played(m)}{m.dupr ? `, DUPR ${rating(m.dupr)}` : ''}</span></span>
                {(flagCounts[m.id] ?? 0) >= 2 && <span className="tag wait">Flagged by {flagCounts[m.id]}</span>}{m.blocked ? <span className="tag off">Blocked</span> : <span className={'tag ' + (m.tier === 'varsity' ? 'ok' : m.tier === 'flagged' ? 'off' : m.tier === 'community' ? 'wait' : '')}>{tierLabel(m.tier)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <Sheet title={open.full_name || 'Member'} onClose={() => setOpen(null)}>
          <p className="small muted" style={{ marginBottom: 12 }}>{[open.phone, open.email].filter(Boolean).join(', ')}<br />
            Joined {fmtDate(open.joined)}. {played(open)}. {open.games_90d} in the last 90 days. Wallet {peso(open.wallet)}.</p>
          <div className="stack">
            {TIERS.map((t) => (
              <label key={t.k} className={'check' + (open.tier === t.k ? ' on' : '')}>
                <input type="radio" name="tier" checked={open.tier === t.k} onChange={() => setTier(open, t.k)} />
                <span><b>{t.label}</b><br /><span className="small muted">{t.when}</span></span>
              </label>
            ))}
          </div>
          {open.tier_changed_at && <p className="small muted" style={{ marginTop: 8 }}>Tier last changed {fmtDate(open.tier_changed_at.slice(0, 10))}.</p>}
          {profile?.super_admin && (
            <div className="stack" style={{ marginTop: 16 }}>
              <div className="h3">Booking</div>
              {open.blocked ? (<>
                <p className="small">Blocked from booking{open.blocked_note ? `: ${open.blocked_note}` : ''}.</p>
                <button className="btn ghost" disabled={busy} onClick={() => setBlocked(open, false)}>Let them book again</button>
              </>) : (<>
                <input className="input" placeholder="Reason (only admins see it)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn ghost" disabled={busy} onClick={() => setBlocked(open, true)}>Block from booking</button>
              </>)}
            </div>
          )}
          <ConductLog memberId={open.id} onChange={loadConduct} />
        </Sheet>
      )}
    </>
  );
}
