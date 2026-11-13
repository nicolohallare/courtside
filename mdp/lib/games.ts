// How many games each player can expect, from players, courts and session length.
// A rec game to 11 plus the changeover takes about 15 minutes, so a court runs about 4 games an hour.
// Past 6 players per court, bench time grows fast and paying joiners start to complain.
export const GAME_MINUTES = 15;
export const COMFORT_PER_COURT = 6;

export function sessionHours(start?: string | null, end?: string | null): number {
  const m = (t?: string | null) => { const [h, mi] = String(t ?? '').slice(0, 5).split(':').map(Number); return Number.isFinite(h) ? h * 60 + (mi || 0) : NaN; };
  let d = m(end) - m(start);
  if (d < 0) d += 24 * 60; // ends after midnight
  return Number.isFinite(d) && d > 0 ? d / 60 : 0;
}

/** Games each player gets when the session is full. Null when the numbers aren't there yet. */
export function gamesEach(players: number, courts: number, start?: string | null, end?: string | null): number | null {
  const h = sessionHours(start, end);
  if (!(players > 0) || !(courts > 0) || !h) return null;
  const perCourt = Math.min(players, courts * 4);
  return Math.floor((perCourt * h * 60 / GAME_MINUTES) / players);
}

const hrs = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1)) + (h === 1 ? ' hour' : ' hours');

/** One line for the session form: the games estimate, and a warning when it's crowded. */
export function crowdCheck(players: number, courts: number, start?: string | null, end?: string | null): { crowded: boolean; text: string } | null {
  const g = gamesEach(players, courts, start, end);
  if (g === null) return null;
  const h = sessionHours(start, end);
  const per = players / courts;
  const base = `About ${g} games each when full (${hrs(h)}, games of about ${GAME_MINUTES} minutes).`;
  if (per <= COMFORT_PER_COURT) return { crowded: false, text: base };
  const cap = courts * COMFORT_PER_COURT;
  const gCap = gamesEach(cap, courts, start, end);
  const sit = Math.round(per - 4);
  return { crowded: true, text: `${Number.isInteger(per) ? per : per.toFixed(1)} players per court: about ${sit} sit out every game. ${base} At ${cap} players (6 per court) it's about ${gCap} each. Long waits are the top reason joiners complain.` };
}
