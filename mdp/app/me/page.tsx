'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { rpc, sb, useSession } from '@/lib/supabase';
import { peso } from '@/lib/format';
import { Loading, SignInPrompt } from '@/components/ui';

interface Profile { full_name: string | null; phone: string | null; access_tier: string | null; is_admin: boolean | null; super_admin: boolean | null }
const TIER: Record<string, string> = { varsity: 'Varsity', member: 'Member', community: 'Community', flagged: 'Flagged' };

export default function Me() {
  const router = useRouter();
  const { userId, ready } = useSession();
  const [p, setP] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<number | null>(null);
  useEffect(() => {
    if (!userId) return;
    sb().from('profiles').select('full_name, phone, access_tier, is_admin, super_admin').eq('id', userId).single().then(({ data }) => setP(data as Profile));
    rpc<number>('my_wallet_balance').then((v) => setWallet(Number(v ?? 0))).catch(() => setWallet(null));
  }, [userId]);
  if (!ready) return <main className="page"><Loading /></main>;
  if (!userId) return <main className="page"><SignInPrompt what="see your profile" /></main>;
  return (
    <main className="page">
      <div className="kicker">Profile</div>
      <h1>{p?.full_name ?? '…'}</h1>
      <div className="panel">
        <div className="row between"><span className="muted">Access</span><strong>{TIER[p?.access_tier ?? ''] ?? '—'}{p?.super_admin ? ' · Super admin' : p?.is_admin ? ' · Admin' : ''}</strong></div>
        <hr />
        <div className="row between"><span className="muted">MDP wallet</span><strong className="num">{wallet === null ? '—' : peso(wallet)}</strong></div>
      </div>
      <button className="btn block" onClick={async () => { await sb().auth.signOut(); router.push('/'); }}>Sign out</button>
    </main>
  );
}
