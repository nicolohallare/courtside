'use client';
// Admin: the same server actions the old app's Admin tab uses (mdp-api, support), with a few
// database functions for the new screens. No rules live here; the server decides.
import { SB_URL, mdpApi, rpc, sb } from './supabase';
import { manilaToday } from './format';
import type { Sess } from './sessions';

export interface AdminSess extends Sess {
  is_active: boolean | null; is_cancelled: boolean | null; published_at: string | null; session_type: string | null;
  backup_gcash_number: string | null; backup_gcash_name: string | null; gcash_owner_user_id: string | null;
  visibility: string | null; venue_id: string | null; coach_name: string | null; court_fee: number | null; ballboy_fee: number | null;
  coach_fee: number | null; coach_gcash_number: string | null; coach_gcash_name: string | null; cancellation_note: string | null;
}

export interface Player {
  id: string; player_name: string; guest_name: string | null; status: string; gcash_ref: string | null;
  ai_check_status: string | null; ai_check_notes: string | null; proof_url: string | null; paid_by_reg_id: string | null;
  amount: number; credit_applied: number | null; gcash_paid: number | null; waitlist_position: number | null;
  coach_amount: number | null; coach_proof_url: string | null; coach_ai_check_status: string | null; blocks_slot: boolean | null;
  dupr_doubles: number | null; dupr_singles: number | null;
}
export interface Counts { total: number; paid: number; pending: number; waitlisted: number; players: Player[] }

export interface Topup { id: string; user_id: string; amount: number; status: string; proof_url: string | null; gcash_ref: string | null; ai_check_notes?: string | null; admin_note: string | null; created_at: string; gateway_ref?: string | null; profiles?: { full_name: string | null } | null }
export interface Overpay { reg_id: string; user_id: string; player_name: string; session_label: string; session_date: string; owed: number; sent: number; excess: number; gcash_ref: string | null; proof_url: string | null }
export interface Ticket { id: string; kind: string; status: string; description: string; submitter_name: string | null; screenshot_url: string | null; admin_reply: string | null; created_at: string }

const daysAgo = (n: number) => { const d = new Date(manilaToday() + 'T12:00:00+08:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

/** Every session from two weeks back, drafts and cancelled ones included. */
export const loadAdminSessions = () => mdpApi<AdminSess[]>('sessions', `include_hidden=true&since=${daysAgo(14)}&limit=80`);
export const loadCounts = () => mdpApi<Record<string, Counts>>('admin-session-counts');
export const loadTopups = () => mdpApi<Topup[]>('admin-topups');
export const loadOverpaid = () => rpc<Overpay[]>('admin_overpaid');

export async function supportApi<T = unknown>(action: string, method = 'GET', body?: unknown): Promise<T> {
  const { data } = await sb().auth.getSession();
  const r = await fetch(`${SB_URL}/functions/v1/support`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}`, 'x-mdp-action': action },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j as { error?: string }).error) throw new Error((j as { error?: string }).error || `Request failed (${r.status})`);
  return j as T;
}
export const loadTickets = () => supportApi<{ tickets: Ticket[] }>('admin-list').then((r) => r.tickets ?? []);

/** Approve or reject a payment. Rejecting also rejects the slots the same payment covered. */
export async function setPayment(p: Player, all: Player[], status: 'paid' | 'rejected', note?: string) {
  await mdpApi('update-status', '', { method: 'PATCH', body: { id: p.id, status, admin_note: status === 'rejected' ? (note || 'No reason given') : null } });
  if (status === 'rejected') {
    for (const k of all.filter((x) => x.paid_by_reg_id === p.id && x.status !== 'cancelled' && x.status !== 'rejected')) {
      await mdpApi('update-status', '', { method: 'PATCH', body: { id: k.id, status: 'rejected', admin_note: note || null } }).catch(() => {});
    }
  }
}

/** What a payment needs from a person, in words. */
export function needsWhy(p: Player): string {
  const n = (p.ai_check_notes ?? '').replace(/^[^\w₱]*(FLAGGED|APPROVED):\s*/i, '');
  if (!p.proof_url && !p.gcash_ref) return 'Added by an admin, not paid yet';
  if (p.ai_check_status === 'flagged') return n.split('\n')[0] || 'The receipt check wasn\'t sure';
  if (p.ai_check_status === 'pending' || !p.ai_check_status) return 'Receipt not checked yet';
  return n.split('\n')[0] || 'Waiting for a person';
}

export const isDraft = (s: AdminSess) => !s.published_at && !s.is_cancelled;
export const isPast = (s: AdminSess) => s.session_date < manilaToday();

/** Fields a new session copies from an earlier one, moved to a new date. Registration opens the same days ahead. */
export function repeatOf(src: AdminSess, date: string): Partial<AdminSess> {
  const shift = (iso: string | null) => {
    if (!iso) return null;
    const days = Math.round((Date.parse(date + 'T00:00:00+08:00') - Date.parse(src.session_date + 'T00:00:00+08:00')) / 86400000);
    return new Date(Date.parse(iso) + days * 86400000).toISOString();
  };
  return {
    label: src.label, session_date: date, venue: src.venue, venue_id: src.venue_id, time_start: src.time_start, time_end: src.time_end,
    fee: src.fee, max_players: src.max_players, courts: src.courts, venue_fee: src.venue_fee, gcash_number: src.gcash_number, gcash_name: src.gcash_name,
    backup_gcash_number: src.backup_gcash_number, backup_gcash_name: src.backup_gcash_name, gcash_owner_user_id: src.gcash_owner_user_id,
    notes: src.notes, visibility: src.visibility ?? 'public', session_type: src.session_type ?? 'open_play', requires_approval: src.requires_approval,
    coach_name: src.coach_name, court_fee: src.court_fee, ballboy_fee: src.ballboy_fee, coach_fee: src.coach_fee,
    coach_gcash_number: src.coach_gcash_number, coach_gcash_name: src.coach_gcash_name,
    varsity_reg_opens_at: shift(src.varsity_reg_opens_at), public_reg_opens_at: shift(src.public_reg_opens_at),
  };
}

/** Next date on the same weekday as `d`, on or after today. */
export function nextSameWeekday(d: string): string {
  const today = manilaToday();
  const x = new Date(d + 'T12:00:00+08:00');
  while (x.toISOString().slice(0, 10) <= today || x.toISOString().slice(0, 10) <= d) x.setDate(x.getDate() + 7);
  return x.toISOString().slice(0, 10);
}
