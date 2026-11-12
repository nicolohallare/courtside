'use client';
import { sb, SB_URL } from './supabase';

// Coaching days. The app handles the club's part only (court and ball boy, to the club GCash);
// players pay the coach directly. Built on the existing training-api and database rules.
export interface TLine { id: string; component: 'club' | 'coach'; amount: number; status: string; ai_status: string | null; ai_notes: string | null; proof_url: string | null; payee_gcash_number: string | null; payee_gcash_name: string | null; is_estimate?: boolean }
export interface TPart { id: string; member_id: string | null; host_member_id: string | null; guest_name: string | null; display_name: string; status: string; dupr_doubles: number | null; lines: TLine[] }
export interface TBooking { id: string; booked_by: string; status: 'active' | 'pending'; pax: number; approval_expires_at: string | null; participants: TPart[] }
export interface TBlock { id: string; time_start: string; time_end: string; status: string; max_pax: number; tier: string | null; roster_locked_at: string | null; bookings: TBooking[] }
export interface TDay {
  id: string; session_date: string; status: string; notes: string | null; coach_name: string | null; coach_fee_per_head: number | null;
  coach_gcash_number: string | null; coach_gcash_name: string | null; ballboy_fee_per_hour: number | null; court_rate_override: number | null;
  venues: { name: string } | null; blocks: TBlock[];
}
export interface TMe { id: string; can_manage: boolean; full_name: string }

export async function trainingApi<T = unknown>(action: string, method = 'GET', body?: unknown): Promise<T> {
  const { data } = await sb().auth.getSession();
  const r = await fetch(`${SB_URL}/functions/v1/training-api?action=${encodeURIComponent(action)}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Request failed (${r.status})`);
  return j as T;
}

export const loadDays = () => trainingApi<{ days: TDay[]; me: TMe }>('days');

export const seatsIn = (b: TBlock) => b.bookings.filter((k) => k.status === 'active').reduce((n, k) => n + k.participants.filter((p) => p.status === 'in').length, 0);
export const clubLines = (p: TPart) => p.lines.filter((l) => l.component === 'club' && !['waived', 'forfeited'].includes(l.status));
/** What's still to send to the club for this player: lines not paid and not waiting for a check. */
export const clubDue = (p: TPart) => clubLines(p).filter((l) => l.status === 'unpaid' || l.status === 'rejected').reduce((n, l) => n + Number(l.amount), 0);
export const clubState = (p: TPart): 'paid' | 'checking' | 'due' | 'none' => {
  const ls = clubLines(p); if (!ls.length) return 'none';
  if (ls.some((l) => l.status === 'unpaid' || l.status === 'rejected')) return 'due';
  if (ls.some((l) => l.status === 'proof_uploaded')) return 'checking';
  return 'paid';
};
export const mine = (p: TPart, me: string) => p.member_id === me || (!p.member_id && p.host_member_id === me);
