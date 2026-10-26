'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/supabase';
import { useMe } from '@/lib/me';
import { peso, rating } from '@/lib/format';
import { Loading } from '@/components/Shell';

const TIER: Record<string, string> = { varsity: 'Varsity', member: 'Member', community: 'Community', flagged: 'Flagged' };

export default function Me() {
  const router = useRouter();
  const { userId, ready, profile, wallet } = useMe();
  if (!ready) return <Loading />;
  if (!userId) return <div className="empty2"><Link href="/login/" style={{ color: 'var(--pk)', fontWeight: 800 }}>Sign in</Link> to see your profile.</div>;
  return (
    <div style={{ padding: '20px 16px 0' }}>
      <div className="inner-ttl">{profile?.full_name ?? '…'}</div>
      <div className="bcard" style={{ marginBottom: 16 }}>
        <div className="brow"><div className="bicon">🏷️</div><div><div className="blbl">Access</div><div className="bval">{TIER[profile?.access_tier ?? ''] ?? 'Member'}{profile?.super_admin ? ' · Super admin' : profile?.is_admin ? ' · Admin' : ''}</div></div></div>
        <div className="brow"><div className="bicon">💰</div><div><div className="blbl">MDP wallet</div><div className="bval g">{wallet === null ? '—' : peso(wallet)}</div></div></div>
        <div className="brow"><div className="bicon">🎾</div><div><div className="blbl">DUPR</div><div className="bval">Doubles {rating(profile?.dupr_doubles)} · Singles {rating(profile?.dupr_singles)}</div></div></div>
        <div className="brow"><div className="bicon">📱</div><div><div className="blbl">Mobile</div><div className="bval">{profile?.phone || 'Not set'}</div></div></div>
      </div>
      <button className="btn btn-ghost" onClick={async () => { await sb().auth.signOut(); router.push('/'); }}>Sign out</button>
    </div>
  );
}
