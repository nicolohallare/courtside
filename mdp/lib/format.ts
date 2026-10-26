// Formatting in Manila time and pesos.
export const TZ = 'Asia/Manila';

export const peso = (n: number | string | null | undefined) =>
  '₱' + Number(n ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** "Fri, Oct 23" from a YYYY-MM-DD date. */
export function fmtDate(d: string): string {
  return new Date(d + 'T12:00:00+08:00').toLocaleDateString('en-PH', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
}
/** "4pm" / "4:30pm" from "16:00" or "16:00:00". */
export function fmtClock(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am', hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`;
}
export const manilaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const rating = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? 'NR' : Number(n).toFixed(2));
