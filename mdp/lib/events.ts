// Tournaments: what the Events tab shows. Registration comes with the tournament build.
export interface Division { name: string; min?: number | null; max?: number | null; age_min?: number | null; gender?: string | null; price?: number | null; second_price?: number | null; spots?: number | null; taken?: number | null }
export interface Tournament { id: string; name: string; tagline: string | null; starts_on: string; ends_on: string | null; venue: string | null; city: string | null; director: string | null; poster_url: string | null; register_url: string | null; blurb: string | null; divisions: Division[] | null }

export function eventDates(t: Tournament) {
  const a = new Date(t.starts_on + 'T12:00:00+08:00'), b = t.ends_on ? new Date(t.ends_on + 'T12:00:00+08:00') : a;
  const m = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short' });
  if (t.ends_on && t.ends_on !== t.starts_on) return m(a) === m(b) ? `${m(a)} ${a.getDate()} to ${b.getDate()}` : `${m(a)} ${a.getDate()} to ${m(b)} ${b.getDate()}`;
  return `${m(a)} ${a.getDate()}`;
}

