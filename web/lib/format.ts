// Formatting in Manila time, peso amounts, and shared types.
export const TZ = 'Asia/Manila';

export const peso = (n: number | string | null | undefined) =>
  '₱' + Number(n ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PH', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
export const fmtRange = (a: string, b: string) => `${fmtTime(a)}–${fmtTime(b)}`;
export const fmtDateTime = (iso: string) => `${fmtDay(iso)}, ${fmtTime(iso)}`;

/** YYYY-MM-DD for "today" in Manila, plus n days. */
export function manilaDate(addDays = 0): string {
  const d = new Date(Date.now() + addDays * 86400_000);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}
/** ISO instant for a Manila local date + "HH:MM". Manila has no DST: fixed +08:00. */
export const manilaInstant = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`).toISOString();

export function minutesLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000));
}

export type Role = 'owner' | 'admin' | 'host' | 'varsity' | 'member' | 'flagged' | 'pending' | 'banned';
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner', admin: 'Admin', host: 'Host', varsity: 'Varsity', member: 'Member',
  flagged: 'Flagged', pending: 'Waiting for approval', banned: 'Banned',
};

export interface Club {
  id: string; slug: string; short_code: string; name: string; tagline: string | null;
  venue_name: string | null; address: string | null; city: string | null;
  gcash_number: string | null; gcash_name: string | null; techpay_enabled: boolean;
  join_policy: 'open' | 'approval'; refund_cutoff_hours: number; court_booking_days_ahead: number;
  court_min_minutes: number; court_max_minutes: number; court_slot_minutes: number; is_published: boolean;
}
export interface SessionRow {
  id: string; title: string; description: string | null; starts_at: string; ends_at: string; fee: number;
  capacity: number; seats_taken: number; waitlist_seats: number; level: string | null; status: string;
  waitlist_enabled: boolean; court_names: string[];
}
export interface Court { id: string; club_id: string; name: string; hourly_rate: number; rentable: boolean; active: boolean; sort: number; surface: string | null }

export const BOOKING_STATUS: Record<string, string> = {
  pending_payment: 'Waiting for payment',
  confirmed: 'Confirmed',
  waitlist_pending_payment: 'Waitlist — waiting for payment',
  waitlisted: 'On the waitlist',
  cancelled: 'Cancelled',
  expired: 'Expired',
};
export const PAYMENT_STATUS: Record<string, string> = {
  pending: 'Being checked', review: 'Club is reviewing', approved: 'Paid', rejected: 'Not accepted',
};
export const METHOD_LABEL: Record<string, string> = { techpay: 'Instant pay', gcash_receipt: 'GCash transfer', cash: 'Cash at the club' };
