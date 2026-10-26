'use client';
import { useCallback, useEffect, useState } from 'react';
import { rpc, sb, useSession } from './supabase';

export interface Profile {
  id: string; full_name: string | null; phone: string | null; access_tier: string | null;
  is_varsity: boolean | null; is_admin: boolean | null; super_admin: boolean | null;
  dupr_doubles: number | null; dupr_singles: number | null;
}

/** The signed-in member: profile and wallet balance. */
export function useMe() {
  const { userId, ready } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!userId) { setProfile(null); setWallet(null); return; }
    const { data } = await sb().from('profiles')
      .select('id, full_name, phone, access_tier, is_varsity, is_admin, super_admin, dupr_doubles, dupr_singles').eq('id', userId).single();
    setProfile(data as Profile);
    rpc<number>('my_wallet_balance').then((v) => setWallet(Number(v ?? 0))).catch(() => setWallet(null));
  }, [userId]);
  useEffect(() => { load(); }, [load]);
  return { userId, ready, profile, wallet, reload: load };
}

/** Same rule as the booking server: first and last name (no initials) and a mobile number. */
export function profileProblem(p: Profile | null): string | null {
  if (!p) return 'Profile still loading. Try again in a second.';
  const words = String(p.full_name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.some((w) => w.length < 2 || /^[A-Za-z]\.?$/.test(w))) return 'Add your first and last name (no initials) in the current app\'s profile first.';
  if (!String(p.phone ?? '').trim()) return 'Add your mobile number in the current app\'s profile first.';
  return null;
}
