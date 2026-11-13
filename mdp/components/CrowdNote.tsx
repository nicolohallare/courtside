'use client';
import { crowdCheck } from '@/lib/games';

/** Under the Max players / Courts fields: games each player can expect, and a warning past 6 per court. */
export function CrowdNote({ players, courts, start, end }: { players: number; courts: number; start?: string; end?: string }) {
  const c = crowdCheck(players, courts, start, end);
  if (!c) return null;
  return <p className={'small' + (c.crowded ? ' crowd-warn' : ' muted')} role={c.crowded ? 'alert' : undefined} style={{ marginTop: -6, marginBottom: 14 }}>{c.text}</p>;
}
