'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { useClub } from '@/lib/club';
import { ROLE_LABEL } from '@/lib/format';
import { useToast } from './ui';

/** Shown until the player can book: sign in → join → add phone → accept house rules. */
export function BookingGate({ c }: { c: ReturnType<typeof useClub> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try { await f(); } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  };
  if (!c.club || c.canBook) return null;

  if (!c.signedIn) return (
    <div className="panel">
      <p>Sign in to book at {c.club.name}.</p>
      <Link className="btn primary" href={`/login?next=/c/${c.club.slug}`}>Sign in</Link>
    </div>
  );
  if (!c.membership) return (
    <div className="panel">
      <p>{c.club.join_policy === 'open' ? `Join ${c.club.name} to book. It’s free.` : `${c.club.name} approves new members. Ask to join and the club will let you know.`}</p>
      <button className="btn primary" disabled={busy} onClick={() => run(c.join)}>{c.club.join_policy === 'open' ? 'Join club' : 'Ask to join'}</button>
    </div>
  );
  if (c.membership.role === 'pending') return <div className="panel"><p>{ROLE_LABEL.pending}. You’ll be able to book once the club approves you.</p></div>;
  if (c.membership.role === 'banned') return <div className="panel"><p>You can’t book at this club. Please contact the club.</p></div>;
  if (!c.phoneOk) return (
    <div className="panel">
      <p>Add your mobile (GCash) number first. Clubs use it to send refunds.</p>
      <Link className="btn primary" href="/me">Add mobile number</Link>
    </div>
  );
  if (!c.rulesOk && c.rules) return (
    <div className="panel">
      <h2>House rules</h2>
      <div style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>{c.rules.body}</div>
      <button className="btn primary block" disabled={busy} onClick={() => run(c.acceptRules)}>I’ve read and accept the house rules</button>
    </div>
  );
  return null;
}
