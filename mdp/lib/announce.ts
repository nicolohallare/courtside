// The message an admin or organizer posts on Reclub or Viber when a session goes up.
// Plain text with a few emoji, so it reads well in a group chat and pastes cleanly anywhere.
import { TZ, fmtClock, peso } from './format';
import { gamesEach } from './games';

export interface AnnounceSession {
  id: string; label: string; session_date: string; time_start: string; time_end: string; venue: string;
  fee: number | string | null; max_players: number | null; courts: number | null; notes: string | null;
  varsity_reg_opens_at: string | null; public_reg_opens_at: string | null; session_type?: string | null;
  requires_approval?: boolean | null; dupr_access?: string | null; label_dupr?: boolean;
}

// Community books 3 days before the start, but never before Members (the database rule).
const COMMUNITY_HOURS = 72;

const when = (iso: string) => new Date(iso).toLocaleString('en-PH', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(/\s?([AP]M)/i, (_, m) => m.toLowerCase());

export function sessionLink(id: string) {
  const origin = typeof location !== 'undefined' ? location.origin : 'https://mdp-app.netlify.app';
  return `${origin}/s/?id=${id}`;
}

export function announcement(s: AnnounceSession, opts: { hostedBy?: string | null } = {}): string {
  const day = new Date(s.session_date + 'T12:00:00+08:00').toLocaleDateString('en-PH', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  const start = Date.parse(`${s.session_date}T${(s.time_start || '18:00').slice(0, 5)}:00+08:00`);
  const need = s.dupr_access ?? (/dupr/i.test(`${s.label} ${s.notes ?? ''}`) ? 'BASIC_L1' : null);
  const lines: string[] = [];
  lines.push(`🏓 ${s.label}`);
  if (opts.hostedBy) lines.push(`Hosted by ${opts.hostedBy}`);
  lines.push('');
  lines.push(`📅 ${day}, ${fmtClock(s.time_start)} to ${fmtClock(s.time_end)}`);
  lines.push(`📍 ${s.venue}`);
  const bits = [s.fee !== null && s.fee !== undefined ? peso(s.fee) : null, s.max_players ? `${s.max_players} spots` : null, s.courts ? `${s.courts} courts` : null].filter(Boolean);
  if (bits.length) lines.push(`💰 ${bits.join(' · ')}`);
  const g = s.session_type === 'coaching' ? null : gamesEach(Number(s.max_players), Number(s.courts), s.time_start, s.time_end);
  if (g !== null) lines.push(`🎾 About ${g} games each when full`);
  if (need === 'PREMIUM_L1') lines.push('⭐ DUPR+ members only: verified DUPR accounts, so every level is real');
  else if (need) lines.push('📈 DUPR night: every game counts on DUPR. Everyone (guests too) needs a DUPR account connected in the app');
  else lines.push('🙌 Open to all, no DUPR needed');
  if (s.requires_approval) lines.push('✋ The host confirms players first: tap "Ask to join", then pay once accepted');
  if (s.session_type !== 'coaching' && (s.varsity_reg_opens_at || s.public_reg_opens_at)) {
    lines.push('');
    lines.push('🕐 Booking opens');
    if (s.varsity_reg_opens_at) lines.push(`Varsity: ${when(s.varsity_reg_opens_at)}`);
    if (s.public_reg_opens_at) {
      lines.push(`Members: ${when(s.public_reg_opens_at)}`);
      const community = Math.max(Date.parse(s.public_reg_opens_at), start - COMMUNITY_HOURS * 3600_000);
      lines.push(`Community: ${when(new Date(community).toISOString())}`);
    }
  }
  if (s.notes && !/dupr/i.test(s.notes)) { lines.push(''); lines.push(s.notes.trim()); }
  lines.push('');
  lines.push('👉 Book and pay in the MDP app:');
  lines.push(sessionLink(s.id));
  return lines.join('\n');
}

/** Copy to the clipboard; fall back to the phone's share sheet. Returns how it went out. */
export async function shareText(text: string, title: string): Promise<'copied' | 'shared' | 'failed'> {
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { /* try share */ }
  try { if (navigator.share) { await navigator.share({ title, text }); return 'shared'; } } catch { /* cancelled */ }
  return 'failed';
}
