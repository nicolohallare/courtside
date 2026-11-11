'use client';
import { useCallback, useEffect, useState } from 'react';
import { mdpApi, rpc, sb, useSession } from './supabase';

export interface Profile {
  id: string; full_name: string | null; phone: string | null; access_tier: string | null;
  is_varsity: boolean | null; is_admin: boolean | null; super_admin: boolean | null;
  dupr_doubles: number | null; dupr_singles: number | null; rules_version_accepted?: number | null; email?: string | null; dupr_id?: string | null;
}

/** The signed-in member: profile and wallet balance. */
export function useMe() {
  const { userId, ready } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!userId) { setProfile(null); setWallet(null); return; }
    const { data } = await sb().from('profiles')
      .select('id, full_name, phone, email, access_tier, is_varsity, is_admin, super_admin, dupr_doubles, dupr_singles, rules_version_accepted, dupr_id').eq('id', userId).single();
    let p = data as Profile | null;
    // A new member gives their mobile number when signing up; it arrives with the account and is saved once.
    if (p && !String(p.phone ?? '').trim()) {
      const { data: u } = await sb().auth.getUser();
      const ph = normPhone(String(u.user?.user_metadata?.phone ?? ''));
      const nm = String(u.user?.user_metadata?.full_name ?? p.full_name ?? '').trim();
      if (ph && !nameProblem(nm)) {
        try { await mdpApi('update-profile', '', { method: 'PATCH', body: { full_name: nm, phone: ph, dupr_id: p.dupr_id ?? '' } }); p = { ...p, phone: ph, full_name: nm }; } catch { /* they can add it on Me */ }
      }
    }
    setProfile(p);
    rpc<number>('my_wallet_balance').then((v) => setWallet(Number(v ?? 0))).catch(() => setWallet(null));
  }, [userId]);
  useEffect(() => { load(); }, [load]);
  return { userId, ready, profile, wallet, reload: load };
}

/** Same rule as the booking server: first and last name (no initials) and a mobile number. */
export function profileProblem(p: Profile | null): string | null {
  if (!p) return 'Profile still loading. Try again in a second.';
  const words = String(p.full_name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.some((w) => w.length < 2 || /^[A-Za-z]\.?$/.test(w))) return 'Add your first and last name (no initials) on the Me tab first.';
  if (!String(p.phone ?? '').trim()) return 'Add your mobile number on the Me tab first.';
  return null;
}

/** First and last name, no initials. Returns what's wrong, or null. */
export function nameProblem(name: string): string | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return 'Enter your first and last name.';
  const init = words.find((w) => w.length < 2 || /^[A-Za-z]\.?$/.test(w));
  if (init) return `"${init}" looks like an initial. Write your full name, no initials.`;
  return null;
}

/** A Philippine mobile number as 09XXXXXXXXX, or null if it isn't one. */
export function normPhone(v: string): string | null {
  let d = v.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('63')) d = '0' + d.slice(2);
  else if (d.length === 10 && d.startsWith('9')) d = '0' + d;
  return d.length === 11 && d.startsWith('09') ? d : null;
}
