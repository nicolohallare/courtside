'use client';
import { rpc } from './supabase';

// Hosts (organizers) run open plays for their own group on the MDP app: Enteng first.
// Server rules live in the host_* database functions; a host only ever sees their own group's sessions.
export interface HostSess {
  id: string; label: string; session_date: string; time_start: string; time_end: string; venue: string; fee: number;
  max_players: number; courts: number | null; notes: string | null; proof: string | null; published: boolean; cancelled: boolean;
  screening: boolean; requests: number; seats: number; paid: number; pending: number; waitlisted: number; locked: boolean;
}
export interface Payouts { due_net: number; due_gross: number; due_fee: number; due_count: number; held_gross: number; held_count: number;
  due_sessions: { session_id: string; label: string; session_date: string; players: number; gross: number; fee: number; net: number }[];
  history: { id: string; amount: number; reference: string | null; note: string | null; sent_at: string }[] }
export interface Org { id: string; name: string; fee_per_player: number; payouts: Payouts | null; sessions: HostSess[] }
export interface RosterRow { name: string; guest: string | null; status: string; at: string; amount: number; wallet: number; gcash: number; checking: boolean; review: boolean }
export interface Req { id: string; name: string; note: string | null; at: string; dupr_d: number | null; mdp_games: number; host_games: number }
export interface Cand { user_id: string; name: string; games: number; last: string | null; in: boolean; invited: boolean }

export const loadHost = () => rpc<Org[]>('host_dashboard');
export const myOrgs = () => rpc<{ id: string; name: string }[]>('my_organizers');
