'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { peso, rating } from '@/lib/format';
import { divisionWho, eventDates, fit, levelName, topUpWithTechPay, type Division, type Entry, type Partner, type RosterRow, type Tournament } from '@/lib/events';
import { Band, Empty, Loading, Sheet, useToast } from '@/components/Shell';
import { Icon } from '@/components/Icon';
import { DuprLogo, DuprTag } from '@/components/Dupr';

export default function EventPage() {
  const toast = useToast();
  const { userId, ready, wallet, reload } = useMe();
  const [t, setT] = useState<Tournament | null | undefined>(undefined);
  const [reg, setReg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [withdraw, setWithdraw] = useState<Entry | null>(null);
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [tab, setTab] = useState<'event' | 'teams'>('event');

  const load = useCallback(async () => {
    const id = new URLSearchParams(location.search).get('id');
    try { setT(await rpc<Tournament | null>('tournament_view', { p_tournament: id })); } catch { setT(null); }
  }, []);
  useEffect(() => { if (ready && userId) load(); else if (ready) setT(null); }, [ready, userId, load]);
  useEffect(() => { if (tab === 'teams' && t?.organizer) rpc<RosterRow[]>('tournament_roster', { p_tournament: t.id }).then(setRoster).catch((e) => toast((e as Error).message, true)); }, [tab, t, toast]);

  if (!ready || t === undefined) return <Loading />;
  if (!userId) return <Empty title="Sign in to see tournaments"><Link className="link" href="/login/?next=/events/">Sign in</Link></Empty>;
  if (!t) return <Empty title="This event isn't open"><Link className="link" href="/events/">See all events</Link></Empty>;

  const me = t.me;
  const entries = t.entries ?? [];
  const bal = Number(wallet ?? 0);

  async function pay(e: Entry) {
    setBusy(true);
    try { await rpc('tournament_pay', { p_entry: e.id }); toast(`Paid. You're in ${e.division}.`); await load(); reload(); }
    catch (err) { toast((err as Error).message, true); }
    setBusy(false);
  }
  async function topUp(e: Entry) {
    setBusy(true);
    try { await topUpWithTechPay(e.price - bal, location.pathname + location.search); }
    catch (err) { toast((err as Error).message, true); setBusy(false); }
  }
  async function doWithdraw(e: Entry) {
    setBusy(true);
    try { const r = await rpc<{ refunded: boolean }>('tournament_withdraw', { p_entry: e.id }); toast(r.refunded ? `Withdrawn. ${peso(e.price)} is back in your wallet.` : 'Withdrawn.'); setWithdraw(null); await load(); reload(); }
    catch (err) { toast((err as Error).message, true); }
    setBusy(false);
  }

  return (
    <div className={t.open ? 'has-cta' : ''}>
      <Band back={{ href: '/events/', label: 'Events' }}>
        <div className="tags"><DuprTag label="Rated" /><span className="tag">{eventDates(t)}</span></div>
        <h1 className="h1" style={{ marginTop: 10 }}>{t.name}</h1>
        {t.tagline && <p className="sub" style={{ marginTop: 4 }}>{t.tagline}</p>}
        {t.organizer && (
          <div className="seg" style={{ marginTop: 14 }} role="tablist">
            <button role="tab" aria-selected={tab === 'event'} className={tab === 'event' ? 'on' : ''} onClick={() => setTab('event')}>Event</button>
            <button role="tab" aria-selected={tab === 'teams'} className={tab === 'teams' ? 'on' : ''} onClick={() => setTab('teams')}>Teams (organizer)</button>
          </div>
        )}
      </Band>

      {tab === 'teams' ? <Teams t={t} roster={roster} /> : (
        <>
          {entries.length > 0 && (
            <div className="section">
              <div className="section-head"><span className="h3">Your entries</span></div>
              <div className="stack">
                {entries.map((e) => (
                  <div key={e.id} className="card stack">
                    <div className="between"><b>{e.division}</b><span className={'tag ' + (e.status === 'paid' ? 'ok' : 'wait')}>{e.status === 'paid' ? 'Paid, you\'re in' : 'Not paid yet'}</span></div>
                    <div className="small muted">With {e.partner}. Team rating {rating(e.team_rating)}{e.playing_up ? ', playing up' : ''}{e.second_event ? ', second division price' : ''}.</div>
                    {e.status === 'unpaid' && (bal >= e.price
                      ? <button className="btn pink" disabled={busy} onClick={() => pay(e)}>Pay {peso(e.price)} from wallet</button>
                      : <>
                          <div className="small">Your wallet has {peso(bal)}. Top up {peso(Math.max(100, e.price - bal))} with TechPay (GCash, Maya, QR Ph or card), then pay.</div>
                          <button className="btn pink" disabled={busy} onClick={() => topUp(e)}>Top up with TechPay</button>
                        </>)}
                    <button className="link" style={{ textAlign: 'left' }} onClick={() => setWithdraw(e)}>Withdraw{e.status === 'paid' ? ' and get a refund to your wallet' : ''}</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="section">
            <div className="dupr-panel">
              <div className="dh"><DuprLogo h={12} light /><span>Your DUPR</span></div>
              {me?.connected ? (
                <>
                  <div className="dr"><span className="grow" style={{ flex: 1 }}>Account</span><span className="ok">{me.dupr_id}</span></div>
                  <div className="dr"><span style={{ flex: 1 }}>Doubles rating</span><b className="num">{rating(me.rating)}</b></div>
                  <div className="dr"><span style={{ flex: 1 }}>Tournament access (from DUPR)</span><span className={me.level ? 'ok' : 'no'}>{levelName(me.level)}</span></div>
                </>
              ) : <div className="dr"><span style={{ flex: 1 }}>Connect DUPR to register. Teams are placed by DUPR rating.</span><Link className="btn sm dupr inline" href="/me/">Connect</Link></div>}
            </div>
          </div>

          <div className="section">
            <div className="section-head"><span className="h3">Divisions</span><span className="sub">Placed by the higher partner&apos;s rating</span></div>
            <div className="list" style={{ display: 'block' }}>
              {(t.divisions ?? []).map((d) => {
                const left = d.spots ? Math.max(0, d.spots - (d.taken ?? 0)) : null;
                const f = fit(d, me?.rating ?? null);
                return (
                  <div key={d.name} className="division">
                    <div>
                      <b>{d.name}</b>
                      {f === 'fits' && <span className="tag ok" style={{ marginLeft: 6 }}>Your level</span>}
                      {d.requires === 'PREMIUM_L1' && <span style={{ marginLeft: 6 }}><DuprTag label="+ only" dark /></span>}
                      <div className="small muted">{divisionWho(d)}</div>
                      {left != null && <div className="small muted">{left === 0 ? 'Full' : `${left} of ${d.spots} teams left`}</div>}
                    </div>
                    <div className="num">{d.price != null ? peso(d.price) : ''}{d.second_price != null && <div className="small muted" style={{ fontFamily: 'var(--body)', fontWeight: 500 }}>2nd: {peso(d.second_price)}</div>}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="section stack">
            <div className="info-list">
              <div><Icon name="pin" /><div><b>{t.venue}</b><div className="muted small">{t.city}</div></div></div>
              {t.director && <div><Icon name="users" /><div><b>Tournament director</b><div className="muted small">{t.director}</div></div></div>}
              <div><Icon name="shield" /><div><b>How placement works</b><div className="muted small">Your team plays where the higher partner&apos;s DUPR rating fits. You can play up a level. Ratings lock when registration closes. A second division costs less.</div></div></div>
              <div><Icon name="wallet" /><div><b>Refunds</b><div className="muted small">Withdraw before the event and your entry goes back to your MDP wallet.</div></div></div>
            </div>
            {t.blurb && <p>{t.blurb}</p>}
          </div>

          {t.open && (
            <div className="sticky-cta">
              <button className="btn pink" onClick={() => setReg(true)}>Register a team</button>
            </div>
          )}
        </>
      )}

      {reg && <RegisterSheet t={t} onClose={() => setReg(false)} onDone={async (msg) => { setReg(false); toast(msg); await load(); }} />}
      {withdraw && (
        <Sheet title={`Withdraw from ${withdraw.division}?`} onClose={() => setWithdraw(null)}>
          <p className="sub" style={{ marginBottom: 14 }}>{withdraw.status === 'paid' ? `${peso(withdraw.price)} goes back to the wallet of whoever paid. ${withdraw.partner} gets a notification.` : `${withdraw.partner} gets a notification.`}</p>
          <div className="btn-row"><button className="btn ghost" onClick={() => setWithdraw(null)}>Keep my entry</button><button className="btn pink" disabled={busy} onClick={() => doWithdraw(withdraw)}>Withdraw</button></div>
        </Sheet>
      )}
    </div>
  );
}

function RegisterSheet({ t, onClose, onDone }: { t: Tournament; onClose: () => void; onDone: (msg: string) => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Partner[] | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [div, setDiv] = useState<string>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const id = setTimeout(() => rpc<Partner[]>('tournament_partners', { p_q: q.trim() }).then(setPeople).catch(() => setPeople([])), 250); return () => clearTimeout(id); }, [q]);

  const me = t.me!;
  const team = partner ? Math.max(Number(me.rating ?? 0), Number(partner.rating ?? 0)) || null : null;
  const d: Division | undefined = (t.divisions ?? []).find((x) => x.name === div);
  const needPremium = d?.requires === 'PREMIUM_L1';
  const okLevel = (l: string | null) => !!l && (!needPremium || l === 'PREMIUM_L1');
  const f = d ? fit(d, team) : 'unknown';
  const blocked = !partner || !d || !me.connected || !partner.connected || !okLevel(me.level) || !okLevel(partner.level) || f === 'over';
  const already = (t.entries ?? []).length > 0;
  const price = d ? (already && d.second_price != null ? d.second_price : d.price) : null;

  async function submit() {
    setBusy(true);
    try {
      const r = await rpc<{ price: number; playing_up: boolean }>('tournament_register', { p_tournament: t.id, p_division: div, p_partner: partner!.id });
      onDone(`Registered for ${div}${r.playing_up ? ' (playing up)' : ''}. Pay ${peso(r.price)} to confirm your spot.`);
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  const row = (label: string, ok: boolean, val: string) => <div className="dr"><span style={{ flex: 1 }}>{label}</span><span className={ok ? 'ok' : 'no'}>{val}</span></div>;
  return (
    <Sheet title="Register a team" onClose={onClose}>
      <div className="field"><span>Your partner</span>
        {partner
          ? <div className="card between"><div><b>{partner.name}</b><div className="small muted">{partner.connected ? `DUPR ${partner.dupr_id}, ${rating(partner.rating)}` : 'DUPR not connected'}</div></div><button className="link" onClick={() => setPartner(null)}>Change</button></div>
          : <>
              <input className="input" aria-label="Search members by name" placeholder="Search members by name" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="list" style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                {!people ? <div className="muted">Loading…</div> : people.length === 0 ? <div className="muted">No members found</div> : people.map((p) => (
                  <button key={p.id} style={{ width: '100%', textAlign: 'left' }} onClick={() => setPartner(p)}>
                    <span className="grow">{p.name}<br /><span className="small muted">{p.connected ? `DUPR ${rating(p.rating)}` : 'DUPR not connected'}</span></span>
                    {p.connected ? <DuprLogo h={9} /> : null}
                  </button>
                ))}
              </div>
            </>}
      </div>

      <div className="field"><span>Division</span>
        <div className="list radio-list" style={{ display: 'block' }}>
          {(t.divisions ?? []).map((x) => {
            const ff = fit(x, team ?? me.rating ?? null), full = x.spots != null && (x.taken ?? 0) >= x.spots;
            const prem = x.requires === 'PREMIUM_L1' && me.level !== 'PREMIUM_L1';
            const off = ff === 'over' || full || prem;
            return (
              <label key={x.name} className={off ? 'off' : ''}>
                <input type="radio" name="div" disabled={off} checked={div === x.name} onChange={() => setDiv(x.name)} />
                <span><b>{x.name}</b>{x.requires === 'PREMIUM_L1' && <span style={{ marginLeft: 6 }}><DuprTag label="+ only" dark /></span>}<br /><span className="small muted">{full ? 'Full' : prem ? 'Needs a DUPR+ membership' : ff === 'over' ? 'Your team rating is above this division' : ff === 'up' ? 'Playing up' : divisionWho(x)}</span></span>
                <span className="num" style={{ fontWeight: 800 }}>{peso(already && x.second_price != null ? x.second_price : x.price)}</span>
              </label>
            );
          })}
        </div>
      </div>

      {partner && (
        <div className="dupr-panel" style={{ marginBottom: 14 }}>
          <div className="dh"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><DuprLogo h={12} light />check</span><span>{needPremium ? 'Needs DUPR+' : 'Any DUPR account'}</span></div>
          {row('You', me.connected && okLevel(me.level), me.connected ? `${rating(me.rating)}, ${levelName(me.level)}` : 'Not connected')}
          {row(partner.name, partner.connected && okLevel(partner.level), partner.connected ? `${rating(partner.rating)}, ${levelName(partner.level)}` : 'Not connected')}
          {d && row('Team rating (higher of you two)', f !== 'over', team ? `${rating(team)}${f === 'up' ? ', playing up' : f === 'over' ? ', too high' : ''}` : '—')}
        </div>
      )}

      <button className="btn pink" disabled={blocked || busy} onClick={submit}>{busy ? 'Checking with DUPR…' : !partner ? 'Pick your partner' : !d ? 'Pick a division' : blocked ? 'Can\'t register this team' : `Register for ${peso(price)}`}</button>
      <p className="small muted" style={{ textAlign: 'center', marginTop: 8 }}>Your partner gets a notification. You pay after registering.</p>
    </Sheet>
  );
}

function Teams({ t, roster }: { t: Tournament; roster: RosterRow[] | null }) {
  const by = useMemo(() => {
    const m = new Map<string, RosterRow[]>();
    for (const r of roster ?? []) m.set(r.division, [...(m.get(r.division) ?? []), r]);
    return m;
  }, [roster]);
  if (!roster) return <Loading rows={3} />;
  const paid = roster.filter((r) => r.status === 'paid');
  return (
    <div className="section stack">
      <div className="card between"><span><b>{roster.length}</b> teams, <b>{paid.length}</b> paid</span><span className="num" style={{ fontWeight: 800 }}>{peso(paid.reduce((n, r) => n + Number(r.price), 0))}</span></div>
      <p className="small muted">Visible to MDP admins who are directors or organizers of the MDP club on DUPR.</p>
      {(t.divisions ?? []).map((d) => {
        const list = by.get(d.name) ?? [];
        return (
          <div key={d.name} className="queue">
            <div className="qh"><span>{d.name}</span><span className="muted">{list.length}{d.spots ? ` of ${d.spots}` : ''}</span></div>
            {list.length === 0 ? <div className="qp muted">No teams yet</div> : list.map((r) => (
              <div key={r.id} className="qp" style={{ alignItems: 'flex-start' }}>
                <span className="nm" style={{ whiteSpace: 'normal' }}>
                  {r.p1.name} & {r.p2.name}
                  <div className="small muted" style={{ fontWeight: 500 }}>{r.p1.dupr} {rating(r.p1.rating)}, {r.p2.dupr} {rating(r.p2.rating)}. {levelName(r.p1.level)} / {levelName(r.p2.level)}</div>
                  <div className="tags" style={{ marginTop: 4 }}>
                    {r.playing_up && <span className="tag wait">Playing up</span>}
                    {r.second_event && <span className="tag">Second division</span>}
                  </div>
                </span>
                <span style={{ textAlign: 'right' }}><b className="num">{rating(r.team_rating)}</b><br /><span className={'tag ' + (r.status === 'paid' ? 'ok' : 'wait')}>{r.status === 'paid' ? 'Paid' : 'Unpaid'}</span></span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
