// Court board: who's waiting, who's next, and on which court.
// Rules (from MDP's DUPR nights, plus what queue apps do well):
//  - Players wait in stacks by level, split into winners and losers (Meg's rule): winners play winners.
//  - The first stack to reach four goes on the next free court. If none has four, a level's
//    winners and losers combine.
//  - Nobody waits too long: past 20 minutes, the longest-waiting player's group goes first.
//  - Fixed partners queue as one unit and always play on the same side. Either can split any time.
//  - Teams are mixed so players who just won together are split: 1st and 4th vs 2nd and 3rd.

export interface BPlayer {
  id: string; ref_no: number | null; name: string; rating: number | null; linked: boolean;
  level: string | null; stack: string | null; status: 'here' | 'playing' | 'resting' | 'no_show' | 'out';
  queued_at: string | null; partner_id: string | null; games: number;
}
export interface BLive { id: string; court: number; game_no: number; started_at: string; seats: (string | null)[] }
export interface BGame { id: string; game_no: number; court: number | null; score_a: number; score_b: number; status: string; seats: (string | null)[] }
export interface BSession { id: string; label: string; venue: string; session_date: string; time_start: string; time_end: string; courts: number; is_dupr: boolean; board_open: boolean; is_admin: boolean; server_now: string; me: string | null }
export interface Board { session: BSession; players: BPlayer[]; live: BLive[]; games: BGame[] }

export const LEVELS: { k: string; label: string; range: string }[] = [
  { k: 'HI', label: 'High-Intermediate', range: 'above 3.5' },
  { k: 'LI', label: 'Low-Intermediate', range: '3.0 to 3.5' },
  { k: 'N', label: 'Novice', range: 'below 3.0' },
  { k: '?', label: 'No level yet', range: 'set by the host' },
];
export const levelName = (k: string | null) => LEVELS.find((l) => l.k === (k ?? '?'))?.label ?? 'No level yet';
export const stackName = (s: string | null) => (s === 'W' ? 'winners' : 'losers');

type Unit = { ids: string[]; level: string; stack: string; t: number };
const ts = (p: BPlayer) => (p.queued_at ? Date.parse(p.queued_at) : 0);

/** Waiting players as queue units (a fixed pair is one unit), in queue order. */
export function units(players: BPlayer[], exclude: Set<string> = new Set()): Unit[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const waiting = players.filter((p) => p.status === 'here' && !exclude.has(p.id))
    .sort((a, b) => ts(a) - ts(b) || (a.ref_no ?? 999) - (b.ref_no ?? 999));
  const used = new Set<string>(), out: Unit[] = [];
  for (const p of waiting) {
    if (used.has(p.id)) continue;
    const mate = p.partner_id ? byId.get(p.partner_id) : undefined;
    if (mate && mate.status !== 'here') continue; // waits for their partner to come back
    const ids = mate && !exclude.has(mate.id) ? [p.id, mate.id] : [p.id];
    ids.forEach((i) => used.add(i));
    out.push({ ids, level: p.level ?? '?', stack: p.stack ?? 'L', t: ts(p) });
  }
  return out;
}

/** Fill four seats from units in order; a pair that doesn't fit is skipped, not split. */
function fill(list: Unit[]): Unit[] | null {
  const pick: Unit[] = []; let n = 0;
  for (const u of list) { if (n + u.ids.length > 4) continue; pick.push(u); n += u.ids.length; if (n === 4) return pick; }
  return null;
}

function teams(pick: Unit[]): string[] {
  const pairs = pick.filter((u) => u.ids.length === 2), singles = pick.filter((u) => u.ids.length === 1).map((u) => u.ids[0]);
  if (pairs.length === 2) return [...pairs[0].ids, ...pairs[1].ids];
  if (pairs.length === 1) return [...pairs[0].ids, ...singles];
  return [singles[0], singles[3], singles[1], singles[2]];
}

export interface Suggestion { label: string; seats: string[]; why: string }

export function suggest(players: BPlayer[], nowMs: number, exclude: Set<string> = new Set()): Suggestion | null {
  const us = units(players, exclude);
  if (us.reduce((n, u) => n + u.ids.length, 0) < 4) return null;
  const groups = new Map<string, Unit[]>();
  for (const u of us) { const k = u.level + '|' + u.stack; groups.set(k, [...(groups.get(k) ?? []), u]); }

  // Longest wait first once someone has waited 20 minutes.
  const oldest = us[0];
  if (oldest && nowMs - oldest.t > 20 * 60_000) {
    const same = groups.get(oldest.level + '|' + oldest.stack) ?? [];
    const level = us.filter((u) => u.level === oldest.level);
    const a = fill(same), b2 = a ? null : fill(level), c = a || b2 ? null : fill(us);
    const pick = a ?? b2 ?? c;
    if (pick) return { label: c ? 'Mixed levels' : levelName(oldest.level), seats: teams(pick), why: 'Longest wait goes first' };
  }
  let best: { pick: Unit[]; t: number; label: string; why: string } | null = null;
  for (const [k, list] of groups) {
    const pick = fill(list); if (!pick) continue;
    const [lv, st] = k.split('|'); const t = Math.max(...pick.map((u) => u.t));
    if (!best || t < best.t) best = { pick, t, label: `${levelName(lv)}, ${stackName(st)}`, why: `First ${stackName(st)} group of four` };
  }
  if (!best) for (const lv of ['HI', 'LI', 'N', '?']) {
    const pick = fill(us.filter((u) => u.level === lv)); if (!pick) continue;
    const t = Math.max(...pick.map((u) => u.t));
    if (!best || t < best.t) best = { pick, t, label: levelName(lv), why: 'Winners and losers together' };
  }
  if (!best) { const pick = fill(us); if (pick) best = { pick, t: 0, label: 'Mixed levels', why: 'Not enough players at one level' }; }
  return best ? { label: best.label, seats: teams(best.pick), why: best.why } : null;
}

/** Where a player stands: games ahead of them in their own group. */
export function myPlace(players: BPlayer[], me: string): { pos: number; group: string; next: boolean } | null {
  const us = units(players);
  const mine = us.find((u) => u.ids.includes(me)); if (!mine) return null;
  const group = us.filter((u) => u.level === mine.level && u.stack === mine.stack);
  let seats = 0;
  for (const u of group) { if (u === mine) break; seats += u.ids.length; }
  return { pos: seats + 1, group: `${levelName(mine.level)}, ${stackName(mine.stack)}`, next: seats + mine.ids.length <= 4 };
}

export const minutesSince = (iso: string, offsetMs: number) => Math.max(0, Math.floor((Date.now() - offsetMs - Date.parse(iso)) / 60000));
export const firstName = (n: string) => n.split(' ')[0];
