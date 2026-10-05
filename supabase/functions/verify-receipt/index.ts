// verify-receipt — reads a GCash/Maya/bank receipt screenshot with Claude vision and decides:
// approved (all checks pass) · review (a person looks) · duplicate (reference already used anywhere on the platform).
// Ported from MDP's verify-payment, generalised to many clubs. The database (record_receipt_check)
// makes the final state change, so this function can't double-credit.
//
// POST { payment_id }  — caller must be the payer or club staff (JWT verified by Supabase).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = Deno.env.get('RECEIPT_MODEL') ?? 'claude-sonnet-5-5';
const MAX_IMG_BYTES = 5 * 1024 * 1024;

export function normPhone(s: string | null | undefined): string {
  if (!s) return '';
  const d = String(s).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('63')) return '0' + d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d;
  if (d.length === 10) return '0' + d;
  return d;
}
// Strict match first; then last-7-digits to tolerate a single OCR miss at the front (MDP 2026-08-09).
export function phoneMatches(expected?: string | null, detected?: string | null): 'exact' | 'ocr' | 'no' {
  const e = normPhone(expected), d = normPhone(detected);
  if (!e || !d) return 'no';
  if (e === d) return 'exact';
  if (e.length >= 7 && d.length >= 7 && e.slice(-7) === d.slice(-7)) return 'ocr';
  return 'no';
}
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

function manilaNow(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}+08:00`;
}

function sniffType(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'heic';
  return null;
}

interface Extracted {
  is_receipt: boolean; looks_authentic: boolean;
  detected_amount_php: number | null; detected_reference: string | null;
  detected_recipient_name: string | null; detected_recipient_number: string | null;
  detected_sender: string | null; detected_date_iso: string | null; reason: string;
}

async function readReceipt(base64: string, mediaType: string, prompt: string, key: string): Promise<Extracted> {
  const r = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1600, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: prompt } ] }] }),
  });
  if (!r.ok) throw new Error(`AI HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  // Newer models may put a reasoning block first: find the text block (MDP 2026-08-10 incident).
  const text = String((data?.content ?? []).find((b: any) => b?.type === 'text')?.text ?? '')
    .replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI answer had no JSON');
    parsed = JSON.parse(m[0]);
  }
  if (!parsed || typeof parsed !== 'object' || !('is_receipt' in parsed)) throw new Error('AI answer missing fields');
  return parsed;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });

  let body: { payment_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body.payment_id) return json({ error: 'payment_id required' }, 400);

  // The caller must be able to see this payment under RLS (payer or club staff).
  const { data: visible } = await asUser.from('payments').select('id').eq('id', body.payment_id).maybeSingle();
  if (!visible) return json({ error: 'Payment not found' }, 404);

  const { data: p } = await svc.from('payments').select('*').eq('id', body.payment_id).single();
  if (!p || p.method !== 'gcash_receipt') return json({ error: 'Not a receipt payment' }, 400);
  if (!['pending', 'review'].includes(p.status)) return json({ result: p.status, already: true });

  const { data: club } = await svc.from('clubs').select('name, gcash_number, gcash_name').eq('id', p.club_id).single();
  const { data: payer } = await svc.from('profiles').select('full_name').eq('id', p.user_id).single();
  let what = 'a booking', bookedAt = p.created_at as string;
  if (p.purpose === 'session_booking') {
    const { data: b } = await svc.from('session_bookings').select('created_at, sessions(title, starts_at)').eq('id', p.purpose_id).single();
    if (b) { what = `open play "${(b as any).sessions?.title}"`; bookedAt = b.created_at; }
  } else {
    const { data: b } = await svc.from('court_bookings').select('created_at, courts(name)').eq('id', p.purpose_id).single();
    if (b) { what = `court rental (${(b as any).courts?.name})`; bookedAt = b.created_at; }
  }

  const record = async (verdict: 'approved' | 'flagged' | 'error', notes: string, extracted: unknown, reference: string | null) => {
    const { data, error } = await svc.rpc('record_receipt_check', {
      p_payment: p.id, p_verdict: verdict, p_notes: notes, p_extracted: extracted ?? {}, p_reference: reference });
    if (error) return json({ error: error.message }, 500);
    return json(data);
  };

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return record('error', 'Automatic check unavailable. Please review this screenshot yourself.', {}, p.reported_reference);

  // Load the screenshot from the private bucket.
  const { data: file, error: dlErr } = await svc.storage.from('receipts').download(p.proof_path);
  if (dlErr || !file) return record('error', `Couldn't open the screenshot (${dlErr?.message ?? 'missing'}).`, {}, p.reported_reference);
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.byteLength > MAX_IMG_BYTES) return record('error', 'Screenshot is larger than 5 MB.', {}, p.reported_reference);
  const type = sniffType(buf);
  if (type === 'heic') return record('error', 'Screenshot is in HEIC format; ask the player for a JPG/PNG.', {}, p.reported_reference);

  const expectedAmount = Math.round(Number(p.amount));
  const prompt = `You are checking a payment screenshot for ${what} at ${club?.name}, a pickleball club in the Philippines.

Context:
- Current date and time in Manila (UTC+8): ${manilaNow()}
- The booking was made at ${bookedAt} (UTC). A legitimate receipt for it is dated around then or later.

Expected payment:
- Amount: ₱${expectedAmount} (integer pesos)
- Recipient GCash number: ${club?.gcash_number}
- Recipient name: ${club?.gcash_name ?? '(not set)'}
- Player who booked: ${payer?.full_name ?? 'unknown'}
- Reference the player typed: ${p.reported_reference ?? '(none)'}

Reading guidance:
- GCash masks names (e.g. "O**** O."). Visible letters consistent with the expected recipient = MATCH.
- Senders may pay from Maya, GoTyme or a bank app to the GCash number. Those are VALID. Judge by recipient number and amount.
- Read the recipient mobile number digit by digit. Report the TOTAL sent as an integer.
- Reference numbers are usually 13 digits. Transcribe exactly.
- Tight crops and low quality are normal. Only set looks_authentic=false for real signs of editing.

Reply ONLY with JSON, no fences:
{"is_receipt": <true if this is a payment receipt from any PH e-wallet or bank app>,
 "looks_authentic": true/false,
 "detected_amount_php": <integer or null>,
 "detected_reference": "<string or null>",
 "detected_recipient_name": "<string or null>",
 "detected_recipient_number": "<string or null>",
 "detected_sender": "<string or null>",
 "detected_date_iso": "<ISO 8601 with +08:00 or null>",
 "reason": "<1-2 plain sentences a club admin can act on>"}`;

  let ai: Extracted;
  try { ai = await readReceipt(encodeBase64(buf), type ?? 'image/jpeg', prompt, key); }
  catch (e) { return record('error', `Automatic check failed (${(e as Error).message}). Please review it yourself.`, {}, p.reported_reference); }

  const passed: string[] = [], failed: string[] = [], info: string[] = [];
  if (ai.is_receipt) passed.push('Payment receipt'); else failed.push('Not recognised as a payment receipt');
  if (ai.looks_authentic) passed.push('Looks unedited'); else failed.push('May be edited');

  const amt = ai.detected_amount_php == null ? null : Math.round(Number(ai.detected_amount_php));
  if (amt === expectedAmount) passed.push(`Amount ₱${expectedAmount}`);
  else if (amt != null && amt < expectedAmount) failed.push(`Underpaid: ₱${amt} sent, ₱${expectedAmount} due (short ₱${expectedAmount - amt})`);
  else if (amt != null) failed.push(`Overpaid: ₱${amt} sent, ₱${expectedAmount} due`);
  else failed.push('Amount not readable');

  const num = phoneMatches(club?.gcash_number, ai.detected_recipient_number);
  if (num === 'exact') passed.push(`Sent to ${club?.gcash_number}`);
  else if (num === 'ocr') passed.push(`Sent to ${club?.gcash_number} (read as ${ai.detected_recipient_number}, last 7 digits match)`);
  else failed.push(`Sent to ${ai.detected_recipient_number ?? 'unknown number'}, not the club's ${club?.gcash_number}`);

  const ref = ai.detected_reference ?? p.reported_reference ?? null;
  if (!ref || digits(ref).length < 6) failed.push('No reference number found');
  else if (p.reported_reference && ai.detected_reference && digits(p.reported_reference) !== digits(ai.detected_reference))
    failed.push(`Reference typed (${p.reported_reference}) differs from screenshot (${ai.detected_reference})`);
  else passed.push(`Reference ${ref}`);

  // Stale receipt: dated well before the booking existed → likely an old screenshot reused.
  if (ai.detected_date_iso) {
    const t = Date.parse(ai.detected_date_iso);
    if (!Number.isNaN(t) && t < Date.parse(bookedAt) - 6 * 3600_000) failed.push(`Receipt dated ${ai.detected_date_iso}, before this booking was made`);
    info.push(`Dated ${ai.detected_date_iso}`);
  }
  if (ai.detected_recipient_name) info.push(`Recipient on receipt: ${ai.detected_recipient_name}`);
  if (ai.detected_sender) info.push(`Sender: ${ai.detected_sender}`);

  const ok = failed.length === 0;
  const notes = [
    ok ? '✓ All checks passed' : `⚠️ ${failed[0]}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ''}`,
    failed.length ? '\nNeeds checking:\n• ' + failed.join('\n• ') : '',
    passed.length ? '\nMatched:\n• ' + passed.join('\n• ') : '',
    info.length ? '\nDetails:\n• ' + info.join('\n• ') : '',
    ai.reason ? '\n' + ai.reason : '',
  ].join('');
  return record(ok ? 'approved' : 'flagged', notes, ai, ref);
});
