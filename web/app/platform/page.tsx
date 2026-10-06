'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { rpc, sb, useSession } from '@/lib/supabase';
import { Loading, SignInPrompt, useToast } from '@/components/ui';
import { fmtDateTime, peso } from '@/lib/format';

interface Acct { method: string; bank_name: string | null; account_name: string; account_number?: string; last4?: string; holder_type: string }
interface Money {
  pending_payouts: { id: string; club_name: string; amount: number; account: Acct; created_at: string }[];
  refunds_owed: { id: string; club_name: string; amount: number; reason: string; full_name: string; phone: string | null; created_at: string }[];
  held_for_clubs: number;
  unverified_accounts: (Acct & { club_id: string; club_name: string; organizer: string | null })[];
}

/** Platform team only: onboard a club and hand it to its owner. */
export default function Platform() {
  const { session, ready, userId } = useSession();
  const toast = useToast();
  const [ok, setOk] = useState<boolean | null>(null);
  const [clubs, setClubs] = useState<{ id: string; slug: string; name: string; short_code: string; techpay_enabled: boolean; is_published: boolean }[]>([]);

  const [money, setMoney] = useState<Money | null>(null);
  const loadMoney = async () => setMoney(await rpc<Money>('platform_money'));
  const load = async () => { loadMoney().catch(() => {}); const { data } = await sb().from('clubs').select('id, slug, name, short_code, techpay_enabled, is_published').order('name'); setClubs(data ?? []); };
  useEffect(() => { if (userId) { rpc<boolean>('is_platform_admin').then(setOk); load(); } }, [userId]);

  if (!ready) return <main className="page"><Loading /></main>;
  if (!session) return <main className="page"><SignInPrompt what="continue" /></main>;
  if (ok === false) return <main className="page"><h1>Not available</h1></main>;

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try {
      let owner: string | null = null;
      const email = String(f.get('owner') ?? '').trim();
      if (email) {
        // owner must already have signed in once
        const found = await rpc<{ user_id: string }[]>('find_player', { p_club: clubs[0]?.id ?? '00000000-0000-0000-0000-000000000000', p_query: email }).catch(() => []);
        owner = found[0]?.user_id ?? null;
        if (!owner) { toast('Owner not found. Ask them to sign in once, then try again (or leave blank to own it yourself).', true); return; }
      }
      await rpc('create_club', { p_name: f.get('name'), p_slug: f.get('slug'), p_short_code: f.get('code'), p_city: f.get('city') || null, p_owner: owner });
      toast('Club created'); e.currentTarget.reset(); load();
    } catch (err) { toast((err as Error).message, true); }
  }
  async function techpay(id: string, on: boolean) {
    const code = on ? prompt('TechPay sub-merchant code for this club (from onboarding):') : '';
    if (on && code === null) return;
    try { await rpc('update_club', { p_club: id, p_patch: { techpay_enabled: on, techpay_merchant_code: code || null } }); load(); }
    catch (err) { toast((err as Error).message, true); }
  }

  async function runPayouts() {
    try {
      const rows = await rpc<{ club_name: string; amount: number; payout_id: string | null; skipped: string | null }[]>('run_payouts', {});
      const made = rows.filter((r) => r.payout_id), skipped = rows.filter((r) => r.skipped);
      toast(`${made.length} payout${made.length === 1 ? '' : 's'} created` + (skipped.length ? ` · skipped: ${skipped.map((r) => `${r.club_name} (${r.skipped})`).join('; ')}` : ''));
      loadMoney();
    } catch (err) { toast((err as Error).message, true); }
  }
  async function mark(id: string, status: 'sent' | 'failed') {
    const ref = prompt(status === 'sent' ? 'Transfer reference (InstaPay, PESONet or GCash):' : 'Why did it fail?');
    if (!ref) return;
    try { await rpc('mark_payout', { p_payout: id, p_status: status, p_reference: ref }); loadMoney(); }
    catch (err) { toast((err as Error).message, true); }
  }
  async function verify(clubId: string) {
    const note = prompt('How did you check this account? (e.g. ID seen, ₱1 test received)');
    if (!note) return;
    try { await rpc('verify_payout_account', { p_club: clubId, p_note: note }); loadMoney(); }
    catch (err) { toast((err as Error).message, true); }
  }
  async function refundSent(id: string) {
    const ref = prompt('GCash or bank reference of the refund you sent:');
    if (!ref) return;
    try { await rpc('settle_refund', { p_refund: id, p_status: 'paid', p_note: ref }); loadMoney(); }
    catch (err) { toast((err as Error).message, true); }
  }
  const acct = (a: Acct) => `${a.method === 'bank' ? a.bank_name : a.method === 'gcash' ? 'GCash' : 'Maya'} · ${a.account_name} · ${a.account_number ?? '…' + a.last4}`;

  return (
    <main className="page">
      <h1>Platform</h1>
      {money && (
        <div className="panel">
          <div className="row between"><h2 style={{ margin: 0 }}>Money we hold for clubs: {peso(money.held_for_clubs)}</h2>
            <button className="btn sm court" onClick={runPayouts}>Run payouts</button></div>
          <p className="small muted">Run weekly. Each club gets one payout for everything past its two-day hold, less refunds. Send it by bank or GCash, then record the reference.</p>
          {money.pending_payouts.map((p) => (
            <div key={p.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>
              <span><strong>{p.club_name}</strong> <span className="num">{peso(p.amount)}</span><div className="small muted">{acct(p.account)} · {fmtDateTime(p.created_at)}</div></span>
              <span><button className="btn sm court" onClick={() => mark(p.id, 'sent')}>Mark sent</button>{' '}<button className="linkbtn small" onClick={() => mark(p.id, 'failed')}>Failed</button></span>
            </div>
          ))}
          {money.refunds_owed.length > 0 && <h3>Refunds we send to players</h3>}
          {money.refunds_owed.map((r) => (
            <div key={r.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>
              <span><strong>{r.full_name}</strong> <span className="num">{peso(r.amount)}</span><div className="small muted">{r.club_name} · {r.reason} · {r.phone ?? 'no mobile on file'}</div></span>
              <button className="btn sm" onClick={() => refundSent(r.id)}>Mark sent</button>
            </div>
          ))}
          {money.unverified_accounts.length > 0 && <h3>Payout accounts to check</h3>}
          {money.unverified_accounts.map((a) => (
            <div key={a.club_id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>
              <span><strong>{a.club_name}</strong><div className="small muted">{acct(a)}{a.holder_type === 'organizer' ? ` · organizer: ${a.organizer ?? '?'}` : ' · club account'}</div></span>
              <button className="btn sm" onClick={() => verify(a.club_id)}>Verified</button>
            </div>
          ))}
        </div>
      )}
      <form className="panel" onSubmit={create}>
        <h2>Add a club</h2>
        <label className="field"><span>Club name</span><input type="text" name="name" required /></label>
        <div className="row">
          <label className="field grow"><span>Web address (courtside…/c/<em>this</em>)</span><input type="text" name="slug" required pattern="[a-z0-9][a-z0-9-]{1,40}" placeholder="sunrise-pickle" /></label>
          <label className="field" style={{ width: 130 }}><span>Payment code</span><input type="text" name="code" required pattern="[A-Za-z0-9]{2,6}" placeholder="SUN" /></label>
        </div>
        <label className="field"><span>City</span><input type="text" name="city" /></label>
        <label className="field"><span>Owner’s email (they must have signed in once)</span><input type="email" name="owner" /></label>
        <button className="btn primary">Create club</button>
      </form>
      <div className="panel">
        {clubs.map((c) => (
          <div key={c.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>
            <span><Link href={`/admin/${c.slug}`}>{c.name}</Link> <span className="small muted">{c.short_code}{c.is_published ? '' : ' · hidden'}</span></span>
            <button className="btn sm" onClick={() => techpay(c.id, !c.techpay_enabled)}>{c.techpay_enabled ? 'Turn off instant pay' : 'Turn on instant pay'}</button>
          </div>
        ))}
      </div>
    </main>
  );
}
