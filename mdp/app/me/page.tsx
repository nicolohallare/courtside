'use client';
import Link from 'next/link';
import { DuprLogo, DuprTag } from '@/components/Dupr';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fn, sb } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { peso, rating } from '@/lib/format';
import { Band, Empty, Loading, Sheet, useToast } from '@/components/Shell';
import { Icon } from '@/components/Icon';
import { pushState, turnOnPush, type PushState } from '@/lib/push';

const TIER: Record<string, string> = { varsity: 'Varsity', member: 'Member', community: 'Community', flagged: 'Member' };
interface Dupr { connected: boolean; env?: string; dupr_id?: string; doubles?: number | null; singles?: number | null; eligible?: boolean; name?: string | null }

export default function Me() {
  const router = useRouter();
  const toast = useToast();
  const { userId, ready, profile, wallet } = useMe();
  const [dupr, setDupr] = useState<Dupr | null>(null);
  const [sso, setSso] = useState<string | null>(null);
  const [saving, setSaving] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);
  const [push, setPush] = useState<PushState | null>(null);
  useEffect(() => { pushState().then(setPush).catch(() => setPush('unsupported')); }, []);
  async function enablePush() {
    try { const s = await turnOnPush(); setPush(s); toast(s === 'on' ? 'Notifications are on' : s === 'blocked' ? 'Notifications are blocked. Allow them in your phone\'s settings for this app.' : 'Notifications are still off'); }
    catch (e) { toast((e as Error).message, true); }
  }
  const loadDupr = useCallback(() => { fn<Dupr>('dupr', 'status').then(setDupr).catch(() => setDupr({ connected: false })); }, []);
  useEffect(() => { if (userId) loadDupr(); }, [userId, loadDupr]);

  // DUPR's login page posts the player's token back to this window once they allow access.
  useEffect(() => {
    if (!sso) return;
    let busy = false;
    const onMsg = (ev: MessageEvent) => {
      let host = ''; try { host = new URL(ev.origin).hostname; } catch { return; }
      if (!/(^|\.)dupr\.(gg|com)$/.test(host) || busy) return;
      let d = ev.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      if (!d || typeof d !== 'object' || !(d.userToken || d.accessToken)) return;
      busy = true; setSaving('Saving your DUPR connection…');
      fn<Dupr>('dupr', 'connect', d).then((r) => { setSso(null); setSaving(''); toast('DUPR connected' + (r.doubles ? `. Doubles ${rating(r.doubles)}` : '')); loadDupr(); })
        .catch((e) => { busy = false; setSaving((e as Error).message); });
    };
    addEventListener('message', onMsg); return () => removeEventListener('message', onMsg);
  }, [sso, toast, loadDupr]);

  async function openSso() {
    try { const r = await fn<{ url: string }>('dupr', 'sso-url'); setSaving(''); setSso(r.url); }
    catch (e) { toast((e as Error).message, true); }
  }
  async function disconnect() {
    try { await fn('dupr', 'disconnect', {}); setConfirmOff(false); toast('DUPR disconnected'); loadDupr(); }
    catch (e) { toast((e as Error).message, true); }
  }

  if (!ready) return <Loading />;
  if (!userId) return <><Band><h1 className="h1" style={{ marginTop: 10 }}>Me</h1></Band><Empty title="Sign in to see your profile"><Link className="link" href="/login/?next=/me/">Sign in</Link></Empty></>;

  const d = dupr?.connected ? dupr.doubles : profile?.dupr_doubles;
  return (
    <>
      <Band>
        <div className="dupr-card" style={{ marginTop: 12 }}>
          <div className={'shield' + (d ? '' : ' nr')}><span className="num">{d ? Number(d).toFixed(2) : 'NR'}</span><DuprLogo h={11} light={!d} /><small>Doubles</small></div>
          <div style={{ minWidth: 0 }}>
            <h1 className="h2" style={{ color: '#fff' }}>{profile?.full_name ?? '…'}</h1>
            <p className="sub">{TIER[profile?.access_tier ?? ''] ?? 'Member'}{profile?.is_varsity ? ', Varsity' : ''}{profile?.super_admin ? ', super admin' : profile?.is_admin ? ', admin' : ''}</p>
            <p className="sub">Singles {rating(dupr?.connected ? dupr.singles : profile?.dupr_singles)}</p>
          </div>
        </div>
      </Band>

      <div className="section">
        <div className="section-head"><DuprLogo h={18} />{dupr?.env && dupr.env !== 'prod' && <span className="tag dupr">DUPR test system</span>}</div>
        {!dupr ? <Loading rows={1} /> : dupr.connected ? (
          <div className="card stack">
            <div className="between"><div><b>Connected</b><div className="small muted">{dupr.name ? `${dupr.name}, ` : ''}DUPR ID {dupr.dupr_id}</div></div><button className="btn sm ghost inline" onClick={() => setConfirmOff(true)}>Disconnect</button></div>
            <div className={'tag ' + (dupr.eligible ? 'ok' : 'wait')} style={{ whiteSpace: 'normal' }}>{dupr.eligible ? 'Your account can play rated games' : 'DUPR says this account can\'t play rated games right now. Check your account in the DUPR app.'}</div>
            <p className="small muted">Your rating updates here after each rated game.</p>
          </div>
        ) : (
          <div className="card stack">
            <p className="small">Connect your DUPR account to join DUPR nights and have your games sent to DUPR. You log in on DUPR&apos;s own page; MDP never sees your password.</p>
            <button className="btn dupr" onClick={openSso}>Connect with <DuprLogo h={14} light /></button>
          </div>
        )}
      </div>

      <div className="section">
        <div className="list">
          <Link href="/bookings/#wallet"><Icon name="wallet" /><span className="grow">MDP wallet</span><b className="num">{wallet === null ? '—' : peso(wallet)}</b><Icon name="chev" className="chev" /></Link>
          {(profile?.is_admin || profile?.super_admin) && <Link href="/courts/results/"><Icon name="upload" /><span className="grow">Send results to DUPR</span><Icon name="chev" className="chev" /></Link>}
          <Link href="/bookings/"><Icon name="ticket" /><span className="grow">Bookings and payments</span><Icon name="chev" className="chev" /></Link>
          <div><Icon name="bell" /><span className="grow">Notifications<br /><span className="small muted">{push === 'on' ? 'On for this phone' : push === 'needs-install' ? 'On iPhone, add the app to your Home Screen first (Share, then Add to Home Screen)' : push === 'blocked' ? 'Blocked. Allow them in your phone\'s settings' : push === 'unsupported' ? 'This browser can\'t show notifications' : 'Payments approved, spots opening, your turn on court'}</span></span>
            {push === 'off' && <button className="btn sm pink inline" onClick={enablePush}>Turn on</button>}</div>
          <div><Icon name="info" /><span className="grow">Mobile</span><span className="muted">{profile?.phone || 'Not set'}</span></div>
          <button onClick={async () => { await sb().auth.signOut(); router.push('/'); }} style={{ width: '100%', textAlign: 'left' }}><Icon name="out" /><span className="grow">Sign out</span></button>
        </div>
      </div>

      <div className="powered">Ratings powered by <DuprLogo h={11} /></div>

      {sso && (
        <Sheet title="Connect your DUPR account" onClose={() => setSso(null)}>
          <p className="sub" style={{ marginBottom: 10 }}>Log in to DUPR and allow Match Day Pickle to see your DUPR ID and rating.</p>
          <iframe src={sso} title="DUPR login" allow="payment" style={{ width: '100%', height: 540, border: '1px solid var(--line-2)', borderRadius: 12, background: '#fff' }} />
          {saving && <p className="small" style={{ marginTop: 8 }}>{saving}</p>}
          <p className="small muted" style={{ marginTop: 8 }}>DUPR remembers the last account you used in this browser. To use a different one, <a className="link" href={dupr?.env === 'prod' ? 'https://dashboard.dupr.com' : 'https://uat.dupr.gg'} target="_blank" rel="noreferrer">log out on DUPR</a>, then close this and tap Connect again.</p>
        </Sheet>
      )}
      {confirmOff && (
        <Sheet title="Disconnect DUPR?" onClose={() => setConfirmOff(false)}>
          <p className="sub" style={{ marginBottom: 14 }}>Your rating stops updating here, and you can&apos;t join DUPR nights until you connect again. Games already sent stay on DUPR.</p>
          <div className="btn-row"><button className="btn ghost" onClick={() => setConfirmOff(false)}>Keep connected</button><button className="btn pink" onClick={disconnect}>Disconnect</button></div>
        </Sheet>
      )}
    </>
  );
}
