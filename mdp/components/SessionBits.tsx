'use client';
import { useRouter } from 'next/navigation';
import { DuprLogo, DuprTag } from '@/components/Dupr';
import { peso } from '@/lib/format';
import { activeReg, isDuprNight, opensAt, spotsLeft, type Reg, type Sess } from '@/lib/sessions';
import { profileProblem, type Profile } from '@/lib/me';

export function SessionTags({ s, host, courts = true }: { s: Sess; host?: string; courts?: boolean }) {
  return (
    <div className="tags">
      {isDuprNight(s) && <DuprTag label="Night" />}
      {s.organizer_id && <span className="tag host">Hosted by {host ?? 'a partner'}</span>}
      {s.requires_approval && <span className="tag">Host approves players</span>}
      {courts && !!s.courts && <span className="tag">{s.courts} court{s.courts === 1 ? '' : 's'}</span>}
    </div>
  );
}

export function Spots({ s }: { s: Sess }) {
  const left = spotsLeft(s), pct = Math.min(100, Math.round((s.seats_used / Math.max(1, s.max_players)) * 100));
  const cls = left === 0 ? 'full' : left <= 4 ? 'warn' : '';
  return (
    <>
      <div className={'bar ' + cls}><i style={{ width: pct + '%' }} /></div>
      <span className={'spots-left ' + cls}>{left === 0 ? (s.waitlist_count ? `Full, ${s.waitlist_count} waiting` : 'Full') : `${left} of ${s.max_players} left`}</span>
    </>
  );
}

export const REG_LABEL: Record<string, { text: string; cls: string }> = {
  paid: { text: 'You\'re in', cls: 'ok' },
  invited: { text: 'Approved, pay to confirm', cls: 'wait' },
  waitlisted: { text: 'On the waitlist', cls: 'wait' },
  pending: { text: 'Payment being checked', cls: 'wait' },
};

export type Cta =
  | { kind: 'mine'; label: string; reg: Reg }
  | { kind: 'book' | 'request' | 'signin'; label: string }
  | { kind: 'blocked'; label: string; hint?: string };

/** What the main button on a session says and does for this member. Same rules as the booking server. */
export function sessionCta(s: Sess, o: { userId: string | null; profile: Profile | null; regs: Reg[]; reqs: Record<string, string>; lead: Record<string, number> }): Cta {
  const mine = activeReg(o.regs, s.id);
  if (mine) return { kind: 'mine', label: REG_LABEL[mine.status]?.text ?? 'Booked', reg: mine };
  if (s.requires_approval && o.reqs[s.id] === 'waiting') return { kind: 'blocked', label: 'Request sent', hint: 'The host will reply in the app.' };
  if (s.requires_approval && o.reqs[s.id] === 'declined') return { kind: 'blocked', label: 'Not this time', hint: 'The host couldn\'t take you for this session.' };
  if (!o.userId) return { kind: 'signin', label: `Sign in to book, ${peso(s.fee)}` };
  const t = opensAt(s, o.profile, o.lead);
  if (t === null || t > Date.now()) {
    const when = t ? new Date(t).toLocaleString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'soon';
    return { kind: 'blocked', label: `Opens ${when}`, hint: 'Booking opens earlier for Varsity and members.' };
  }
  if (spotsLeft(s) === 0) return { kind: 'blocked', label: 'Session full' };
  if (s.requires_approval) return { kind: 'request', label: 'Ask to join' };
  return { kind: 'book', label: `Book a spot, ${peso(s.fee)}` };
}

export function useCtaAction(onRequest: (s: Sess) => void, toast: (m: string, bad?: boolean) => void, profile: Profile | null) {
  const router = useRouter();
  return (s: Sess, c: Cta) => {
    if (c.kind === 'mine') { router.push('/bookings/'); return; }
    if (c.kind === 'signin') { router.push('/login/?next=' + encodeURIComponent('/s/?id=' + s.id)); return; }
    if (c.kind === 'blocked') { if (c.hint) toast(c.hint); return; }
    const why = profileProblem(profile); if (why) { toast(why, true); return; }
    if (c.kind === 'request') { onRequest(s); return; }
    router.push('/book/?s=' + s.id);
  };
}
