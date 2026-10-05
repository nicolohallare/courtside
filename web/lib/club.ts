'use client';
import { useCallback, useEffect, useState } from 'react';
import { rpc, sb, useSession } from './supabase';
import type { Club, Role } from './format';

export interface Membership { role: Role; rules_version_accepted: number | null }
export interface Rules { version: number; body: string }

/** Club by slug, the viewer's membership, the latest house rules, and whether they can book yet. */
export function useClub(slug: string) {
  const { userId, ready } = useSession();
  const [club, setClub] = useState<Club | null | undefined>(undefined);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [phoneOk, setPhoneOk] = useState(false);

  const load = useCallback(async () => {
    const { data: c } = await sb().from('clubs').select('*').eq('slug', slug).maybeSingle();
    setClub((c as Club) ?? null);
    if (!c) return;
    const { data: r } = await sb().from('house_rules').select('version, body').eq('club_id', c.id)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    setRules(r ?? null);
    if (userId) {
      const { data: m } = await sb().from('memberships').select('role, rules_version_accepted')
        .eq('club_id', c.id).eq('user_id', userId).maybeSingle();
      setMembership((m as Membership) ?? null);
      const { data: p } = await sb().from('profiles').select('phone').eq('id', userId).single();
      setPhoneOk(!!p?.phone && p.phone.replace(/\D/g, '').length >= 10);
    } else setMembership(null);
  }, [slug, userId]);
  useEffect(() => { if (ready) load(); }, [load, ready]);

  const rulesOk = !rules || (membership?.rules_version_accepted ?? 0) >= rules.version;
  const canBook = !!membership && !['pending', 'banned'].includes(membership.role) && rulesOk && phoneOk;
  const isStaff = !!membership && ['owner', 'admin', 'host'].includes(membership.role);
  const isAdmin = !!membership && ['owner', 'admin'].includes(membership.role);

  async function join() { await rpc('join_club', { p_club: club!.id }); await load(); }
  async function acceptRules() { await rpc('accept_house_rules', { p_club: club!.id, p_version: rules!.version }); await load(); }

  return { club, membership, rules, rulesOk, phoneOk, canBook, isStaff, isAdmin, signedIn: !!userId, ready, reload: load, join, acceptRules };
}
