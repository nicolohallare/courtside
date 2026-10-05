// techpay — TechPay hosted checkout for club bookings.
//   GET  ?action=channels&amount=X   enabled methods + indicative fee (display only)
//   POST ?action=start {purpose, booking_id}   (player JWT) → { pay_url, payment_id }
//   POST ?action=webhook                       (TechPay)    → verify by calling TechPay back, settle once
// Deploy with verify_jwt = false (TechPay has no Supabase token); `start` checks the user itself.
// Rules from the techpay-gateway skill: secrets only in env, webhook is a nudge, settle idempotently,
// amount must match, server makes references, log every webhook.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HOST = Deno.env.get('TECHPAY_HOST') ?? 'api-stg.techpay.com.ph';
const USER = Deno.env.get('TECHPAY_USER') ?? '';
const PASS = Deno.env.get('TECHPAY_PASS') ?? '';
const SIG_KEY = Deno.env.get('TECHPAY_SIGNATURE_KEY') ?? '';
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
// Field name TechPay uses to route a payment to a club's sub-merchant. Unset until TechPay confirms it;
// until then all payments settle to the platform merchant and are split by reference prefix (CS<CLUB>…).
const SUBMERCHANT_FIELD = Deno.env.get('TECHPAY_SUBMERCHANT_FIELD') ?? '';
const FN_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/techpay`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } });

async function token(): Promise<string> {
  const r = await fetch(`https://${HOST}/v1/biller/token/create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const j = await r.json().catch(() => ({}));
  const t = j?.data?.token;
  if (!t) throw new Error(`Payment gateway rejected our credentials: ${j?.message ?? r.status}`);
  return t;
}

async function lookUp(reference: string) {
  const t = await token();
  const r = await fetch(`https://${HOST}/v1/biller/transactions?reference_no=${encodeURIComponent(reference)}&per_page=5`,
    { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json();
  const list = j?.data?.transactions;
  if (!Array.isArray(list)) return null;
  return list.find((x: Record<string, unknown>) => x.reference_no === reference) ?? null;
}

async function hmacHex(msg: string) {
  if (!SIG_KEY) return '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SIG_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function rates() {
  try {
    const { data } = await admin().from('app_config').select('key,value').in('key', ['fee_qrph', 'fee_card']);
    const m: Record<string, number> = {};
    (data ?? []).forEach((r: { key: string; value: string }) => { m[r.key] = Number(r.value); });
    return { qrph: Number.isFinite(m.fee_qrph) ? m.fee_qrph : 0.0175, card: Number.isFinite(m.fee_card) ? m.fee_card : 0.03 };
  } catch { return { qrph: 0.0175, card: 0.03 }; }
}

function newReference(shortCode: string) {
  const rand = crypto.getRandomValues(new Uint8Array(4));
  const r = Array.from(rand).map((b) => (b % 36).toString(36)).join('').toUpperCase();
  return `CS${shortCode}${Date.now().toString(36).toUpperCase()}${r}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (action === 'channels') {
    try {
      const amount = Number(url.searchParams.get('amount') ?? 0);
      const t = await token();
      const j = await (await fetch(`https://${HOST}/v1/biller/channels`, { headers: { Authorization: `Bearer ${t}` } })).json();
      const rate = await rates();
      const channels = (Array.isArray(j?.data) ? j.data : [])
        .filter((c: Record<string, unknown>) => !c.is_disabled)
        .map((c: Record<string, any>) => {
          const isCard = /CARD/i.test(String(c.code)) || /card/i.test(String(c.category?.name ?? ''));
          const pct = isCard ? rate.card : rate.qrph;
          const fee = amount > 0 ? Math.round(amount * pct * 100) / 100 : null;
          return { code: c.code, name: c.name, logo: c.logo, category: c.category?.name ?? '', fee_percent: pct, service_fee: fee };
        });
      return json({ ok: true, channels });
    } catch (e) { return json({ error: (e as Error).message }, 502); }
  }

  if (action === 'start') {
    try {
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return json({ error: 'Please sign in again' }, 401);

      const { purpose, booking_id } = await req.json();
      if (!['session_booking', 'court_booking'].includes(purpose) || !booking_id) return json({ error: 'Bad request' }, 400);
      const table = purpose === 'session_booking' ? 'session_bookings' : 'court_bookings';
      const { data: bk } = await admin().from(table).select('club_id, clubs(short_code)').eq('id', booking_id).single();
      if (!bk) return json({ error: 'Booking not found' }, 404);
      const reference = newReference((bk as any).clubs.short_code);

      // Amount and ownership are decided in the database, never by the client.
      const { data: started, error: startErr } = await sb.rpc('start_gateway_payment', {
        p_purpose: purpose, p_booking: booking_id, p_reference: reference });
      if (startErr) return json({ error: startErr.message }, 400);
      const s = started as { id: string; amount: number; merchant_code: string | null };

      const linkBody: Record<string, unknown> = {        // NO `items` field (see skill §3)
        amount: Number(s.amount), reference_no: reference,
        success_redirect_url: `${APP_URL}/pay/${s.id}?r=done`,
        failure_redirect_url: `${APP_URL}/pay/${s.id}?r=failed`,
        callback_webhook_url: `${FN_URL}?action=webhook`,
      };
      if (SUBMERCHANT_FIELD && s.merchant_code) linkBody[SUBMERCHANT_FIELD] = s.merchant_code;

      const t = await token();
      const r = await fetch(`https://${HOST}/v1/biller/links/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify(linkBody),
      });
      const j = await r.json().catch(() => ({}));
      const payUrl = j?.data?.web_payment_url ?? j?.data?.link_url;
      if (!payUrl) {
        await admin().from('payments').update({ status: 'rejected', gateway_status: 'failed',
          review_note: `Gateway would not create the payment: ${JSON.stringify(j?.errors ?? j?.message ?? r.status)}` })
          .eq('gateway_ref', reference);
        return json({ error: j?.message || 'The payment page would not open. Please try again.' }, 502);
      }
      await admin().from('payments').update({ gateway_payload: j?.data ?? null }).eq('gateway_ref', reference);
      return json({ ok: true, reference, pay_url: payUrl, payment_id: s.id, expires_at: j?.data?.link_expires_at ?? null });
    } catch (e) { return json({ error: (e as Error).message }, 500); }
  }

  if (action === 'webhook') {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* handled below */ }
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    const data = (body?.data ?? {}) as Record<string, unknown>;
    const reference = String(data.reference_no ?? '');
    const claimed = String(data.status ?? '');
    const received = String(data.signature ?? '').toLowerCase();
    const expected = reference ? await hmacHex(`${String(data.amount)}@${reference}`) : '';
    const note = async (outcome: string, ok: boolean) => {
      try {
        await admin().rpc('log_gateway_webhook', { p_ip: ip || null, p_reference: reference || null,
          p_amount: Number(data.amount) || null, p_status: claimed || null, p_sig_recv: received || null,
          p_sig_exp: expected || null, p_ok: ok, p_outcome: outcome, p_payload: body });
      } catch { /* logging must never break the response */ }
    };

    if (!reference) { await note('ignored: no reference', false); return json({ error: 'bad payload' }, 400); }
    if (!reference.startsWith('CS')) { await note('ignored: not a Courtside reference', false); return json({ ok: true }); }
    let real: Record<string, unknown> | null = null;
    try { real = await lookUp(reference); }
    catch (e) { await note(`could not verify: ${(e as Error).message}`, false); return json({ error: 'retry' }, 500); }
    if (!real) { await note('REJECTED: TechPay has no such transaction', false); return json({ error: 'unknown transaction' }, 404); }

    const trueStatus = String(real.status ?? '');
    const trueAmount = Number(real.subtotal_amount ?? real.total_amount ?? 0);
    const { data: result, error } = await admin().rpc('settle_gateway_payment', {
      p_reference: reference, p_amount: trueAmount, p_status: trueStatus,
      p_fee: Number(real.service_fee ?? 0) || null, p_payload: { webhook: body, verified: real } });
    if (error) { await note(`database error: ${error.message}`, true); return json({ error: 'retry' }, 500); }
    await note(`verified: ${trueStatus} ₱${trueAmount} — ${JSON.stringify(result)}` +
      (claimed && claimed !== trueStatus ? ` (webhook claimed '${claimed}')` : ''), true);
    return json({ ok: true });
  }

  // Player came back from TechPay: nudge a verification so they don't wait for the webhook.
  if (action === 'check') {
    try {
      const { payment_id } = await req.json();
      const { data: p } = await admin().from('payments').select('gateway_ref, status').eq('id', payment_id).single();
      if (!p?.gateway_ref) return json({ error: 'not found' }, 404);
      if (p.status !== 'pending') return json({ status: p.status });
      const real = await lookUp(p.gateway_ref);
      if (!real) return json({ status: 'pending' });
      const { data } = await admin().rpc('settle_gateway_payment', {
        p_reference: p.gateway_ref, p_amount: Number(real.subtotal_amount ?? real.total_amount ?? 0),
        p_status: String(real.status ?? ''), p_fee: Number(real.service_fee ?? 0) || null, p_payload: { verified: real, via: 'check' } });
      return json({ ok: true, result: data });
    } catch (e) { return json({ error: (e as Error).message }, 500); }
  }

  return json({ error: 'unknown action' }, 400);
});
