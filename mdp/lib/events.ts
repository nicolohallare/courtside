// Tournaments: what the Events tab shows and how a team registers.
import { SB_URL, sb } from './supabase';

export interface Division { name: string; min?: number | null; max?: number | null; age_min?: number | null; gender?: string | null; price?: number | null; second_price?: number | null; spots?: number | null; taken?: number | null; requires?: string | null }
export interface DuprStanding { connected: boolean; dupr_id: string | null; rating: number | null; level: 'BASIC_L1' | 'PREMIUM_L1' | null }
export interface Entry { id: string; division: string; status: 'unpaid' | 'paid'; price: number; team_rating: number; playing_up: boolean; second_event: boolean; i_registered: boolean; partner: string }
export interface Tournament {
  id: string; name: string; tagline: string | null; starts_on: string; ends_on: string | null; venue: string | null; city: string | null;
  director: string | null; poster_url: string | null; register_url: string | null; blurb: string | null; divisions: Division[] | null;
  me?: DuprStanding; organizer?: boolean; open?: boolean; entries?: Entry[];
}
export interface Partner extends DuprStanding { id: string; name: string }
export interface RosterRow { id: string; division: string; status: string; price: number; team_rating: number; playing_up: boolean; second_event: boolean; created_at: string;
  p1: { name: string; rating: number | null; dupr: string | null; level: string | null }; p2: { name: string; rating: number | null; dupr: string | null; level: string | null } }

export function eventDates(t: Tournament) {
  const a = new Date(t.starts_on + 'T12:00:00+08:00'), b = t.ends_on ? new Date(t.ends_on + 'T12:00:00+08:00') : a;
  const m = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short' });
  if (t.ends_on && t.ends_on !== t.starts_on) return m(a) === m(b) ? `${m(a)} ${a.getDate()} to ${b.getDate()}` : `${m(a)} ${a.getDate()} to ${m(b)} ${b.getDate()}`;
  return `${m(a)} ${a.getDate()}`;
}

export const levelName = (l: string | null | undefined) => (l === 'PREMIUM_L1' ? 'Premium' : l === 'BASIC_L1' ? 'Basic' : 'Not allowed');

/** Who a division is for, in words. */
export function divisionWho(d: Division) {
  const f = (n: number) => Number(n).toFixed(2);
  const r = d.min != null && d.max != null ? `DUPR ${f(d.min)} to ${f(d.max)}` : d.max != null ? `DUPR up to ${f(d.max)}` : d.min != null ? `DUPR ${f(d.min)} and up` : 'All ratings';
  return [r, d.age_min ? `${d.age_min} and over` : null, d.gender === 'M' ? 'Men' : d.gender === 'F' ? 'Women' : d.gender === 'X' ? 'Mixed pairs' : null].filter(Boolean).join(', ');
}

/** Same rule as the server: the higher partner's rating decides; above the limit is out, below the floor is "playing up". */
export function fit(d: Division, team: number | null): 'fits' | 'up' | 'over' | 'unknown' {
  if (team == null) return 'unknown';
  if (d.max != null && team > Number(d.max)) return 'over';
  if (d.min != null && team < Number(d.min)) return 'up';
  return 'fits';
}

/** Start a TechPay payment that tops up the wallet, then come back to `back`. */
export async function topUpWithTechPay(amount: number, back: string): Promise<void> {
  const { data } = await sb().auth.getSession();
  const r = await fetch(`${SB_URL}/functions/v1/techpay?action=start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify({ amount: Math.max(100, Math.ceil(amount)) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.pay_url) throw new Error(j.error || 'TechPay didn\'t open. Try again in a minute.');
  try { sessionStorage.setItem('mdp-after-topup', back); } catch { /* */ }
  location.href = j.pay_url;
}
