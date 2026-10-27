'use client';
import { mdpApi, rpc } from './supabase';
import type { Profile } from './me';

export interface Sess {
  id: string; label: string; session_date: string; time_start: string; time_end: string; venue: string; notes: string | null;
  fee: number; max_players: number; seats_used: number; waitlist_count: number; courts: number | null;
  organizer_id: string | null; requires_approval: boolean | null; venue_proof_path: string | null; is_special: boolean | null;
  varsity_reg_opens_at: string | null; public_reg_opens_at: string | null; gcash_number: string | null; gcash_name: string | null; venue_fee: number | null;
}
export interface Reg {
  id: string; session_uuid: string; status: string; amount: number; credit_applied: number | null; gcash_paid: number | null;
  guest_name: string | null; proof_url: string | null; ai_check_status: string | null; waitlist_position: number | null; paid_by_reg_id: string | null;
  sessions?: { label: string; session_date: string; venue: string; time_start: string; time_end: string; fee: number; is_cancelled: boolean; gcash_number: string | null; gcash_name: string | null } | null;
}
export interface RosterRow { id: string; player_name: string; guest_name: string | null; status: string; dupr_doubles: number | null; dupr_singles: number | null; blocks_slot: boolean | null }

export const loadSessions = () => mdpApi<Sess[]>('sessions', 'upcoming=true&limit=20');
export const loadMyRegs = () => mdpApi<Reg[]>('my-regs');
export const loadRoster = (id: string) => mdpApi<RosterRow[]>('roster', 'session_uuid=' + id);
export async function loadHosts(): Promise<Record<string, string>> { try { return (await rpc<Record<string, string>>('organizer_names')) ?? {}; } catch { return {}; } }
export async function loadMyRequests(): Promise<Record<string, string>> {
  try { const l = await rpc<{ session_id: string; status: string }[]>('my_join_requests'); return Object.fromEntries((l ?? []).map((x) => [x.session_id, x.status])); } catch { return {}; }
}
export async function loadLeadHours(): Promise<Record<string, number>> { try { return (await rpc<Record<string, number>>('tier_lead_hours')) ?? {}; } catch { return {}; } }

export const activeReg = (regs: Reg[], sid: string) => regs.find((r) => r.session_uuid === sid && r.status !== 'cancelled' && r.status !== 'rejected') ?? null;

/** When booking opens for this member (same tiers as the current app). Host sessions open to everyone when published. */
export function opensAt(s: Sess, p: Profile | null, lead: Record<string, number>): number | null {
  if (s.organizer_id) return s.public_reg_opens_at ? Date.parse(s.public_reg_opens_at) : null;
  const tier = p?.access_tier ?? 'member';
  const base = p?.is_varsity ? s.varsity_reg_opens_at : s.public_reg_opens_at;
  let t = base ? Date.parse(base) : null;
  if (t !== null && (tier === 'community' || tier === 'flagged')) {
    const hours = Number(lead[tier] ?? (tier === 'community' ? 24 : 1));
    const start = Date.parse(`${s.session_date}T${(s.time_start || '00:00').slice(0, 5)}:00+08:00`);
    t = Math.max(t, start - hours * 3600_000);
  }
  return t;
}

/** Upload a GCash receipt the same way the current app does; returns its public link.
 *  Storage sometimes fails on the first try (a 5xx from Supabase), so it retries once by itself. */
export async function uploadReceipt(file: File, token: string, query = '', onPct?: (n: number) => void): Promise<string> {
  try { return await uploadOnce(file, token, query, onPct); }
  catch (e) {
    if (!(e as { retry?: boolean }).retry) throw e;
    await new Promise((r) => setTimeout(r, 1200));
    return uploadOnce(file, token, query, onPct);
  }
}

async function uploadOnce(file: File, token: string, query: string, onPct?: (n: number) => void): Promise<string> {
  const { SB_URL } = await import('./supabase');
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${SB_URL}/functions/v1/mdp-api${query ? '?' + query : ''}`);
    x.setRequestHeader('x-mdp-action', 'upload-proof');
    x.setRequestHeader('x-file-type', file.type);
    x.setRequestHeader('Authorization', 'Bearer ' + token);
    x.upload.onprogress = (e) => { if (e.lengthComputable && onPct) onPct(Math.round((e.loaded / e.total) * 100)); };
    x.onload = () => {
      let j: { url?: string; error?: string } = {};
      try { j = JSON.parse(x.responseText || '{}'); } catch { /* */ }
      if (x.status >= 200 && x.status < 300 && j.url) resolve(j.url);
      else reject(Object.assign(new Error(j.error || 'The upload didn\'t go through. Try again.'), { retry: x.status >= 500 }));
    };
    x.onerror = () => reject(Object.assign(new Error('Your connection dropped during the upload. Try again.'), { retry: true }));
    x.send(file);
  });
}

export const isDuprNight = (s: { label?: string | null; notes?: string | null }) => /dupr/i.test(`${s.label ?? ''} ${s.notes ?? ''}`);
export const spotsLeft = (s: Sess) => Math.max(0, s.max_players - s.seats_used);
