'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { rpc, sb, useSession } from '@/lib/supabase';
import { Loading, SignInPrompt, useToast } from '@/components/ui';

/** Platform team only: onboard a club and hand it to its owner. */
export default function Platform() {
  const { session, ready, userId } = useSession();
  const toast = useToast();
  const [ok, setOk] = useState<boolean | null>(null);
  const [clubs, setClubs] = useState<{ id: string; slug: string; name: string; short_code: string; techpay_enabled: boolean; is_published: boolean }[]>([]);

  const load = async () => { const { data } = await sb().from('clubs').select('id, slug, name, short_code, techpay_enabled, is_published').order('name'); setClubs(data ?? []); };
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

  return (
    <main className="page">
      <h1>Platform</h1>
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
