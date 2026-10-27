// DUPR for the MDP app (signed-in members only).
//   Players: sso-url, connect, status, disconnect
//   Admins:  send-session, remove-match, update-match
// DUPR's rating updates arrive at the separate dupr-partner function (no login on that one).
// Keys live in Edge Function secrets. Player DUPR logins are stored server-side only.
//
// While DUPR_ENV is 'uat', connections are kept in dupr_links only and profiles are not
// touched, so testing on DUPR's test system never overwrites a member's real DUPR ID.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ENV = (Deno.env.get('DUPR_ENV') ?? 'uat').toLowerCase();
const PROD = ENV === 'prod';
const PARTNER = PROD ? 'https://prod.mydupr.com/api' : 'https://uat.mydupr.com/api';
const PUBLIC_API = PROD ? 'https://api.dupr.gg' : 'https://api.uat.dupr.gg';
const SSO_BASE = PROD ? 'https://dashboard.dupr.com/login-external-app/' : 'https://uat.dupr.gg/login-external-app/';
const KEY = Deno.env.get('DUPR_CLIENT_KEY') ?? '';
const SECRET = Deno.env.get('DUPR_CLIENT_SECRET') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL')!;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const admin = () => createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

// DUPR's partner token lasts an hour. Keep it in memory and in the database, so a freshly
// started function does not spend a round trip to DUPR fetching a new one.
let cached: { token: string; until: number } | null = null;
async function partnerToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const db = admin();
  const { data: row } = await db.from('dupr_token_cache').select('token, valid_until').eq('env', ENV).maybeSingle();
  if (row && new Date(row.valid_until).getTime() > Date.now() + 60_000) {
    cached = { token: row.token, until: new Date(row.valid_until).getTime() };
    return row.token;
  }
  const r = await fetch(`${PARTNER}/auth/v1.0/token`, { method: 'POST', headers: { 'x-authorization': btoa(`${KEY}:${SECRET}`), 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
  const token = (await r.json())?.result?.token;
  if (!token) throw new Error('Could not reach DUPR right now. Try again in a minute.');
  cached = { token, until: Date.now() + 50 * 60_000 };
  await db.from('dupr_token_cache').upsert({ env: ENV, token, valid_until: new Date(cached.until).toISOString() });
  return token;
}
// Every call to DUPR gives up after 20 seconds, so a slow DUPR never leaves the app spinning.
async function partner(path: string, method = 'GET', body?: unknown, timeoutMs = 20_000) {
  try {
    const r = await fetch(`${PARTNER}${path}`, { method, signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${await partnerToken()}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* */ }
    return { status: r.status, body: j ?? { message: t.slice(0, 200) } };
  } catch (e) {
    const slow = (e as Error)?.name === 'TimeoutError';
    return { status: slow ? 504 : 502, body: { message: slow ? 'DUPR took too long to answer.' : 'Could not reach DUPR.' } };
  }
}
async function asUser(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await fetch(`${PUBLIC_API}${path}`, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* */ }
  return { status: r.status, body: j };
}
const hasBasic = (subs: unknown) => JSON.stringify(subs ?? '').includes('BASIC_L1');
const roleIn = (clubs: any, clubId: number) => {
  const list: any[] = clubs?.membership ?? clubs ?? [];
  return Array.isArray(list) ? (list.find((m) => Number(m.clubId) === clubId)?.role ?? null) : null;
};
async function clubId(db: SupabaseClient): Promise<number | null> {
  const { data } = await db.from('app_config').select('value').eq('key', `dupr_club_id_${ENV}`).maybeSingle();
  return data?.value ? Number(data.value) : null;
}
// The fields DUPR's create and update calls take. We keep DUPR's create reply under _result.
const MATCH_FIELDS = ['identifier', 'event', 'bracket', 'location', 'matchDate', 'format', 'matchType', 'matchSource', 'clubId', 'teamA', 'teamB', 'extras'];
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const why = (r: { status: number; body: any }) => {
  const w = r.body?.message ?? r.body?.errors ?? `DUPR said ${r.status}`;
  const s = typeof w === 'string' ? w : JSON.stringify(w);
  // DUPR's gateway answers timeouts with an HTML page; show a sentence instead.
  if (/^\s*</.test(s)) return r.status === 504 ? 'DUPR\'s server timed out' : `DUPR's server had a problem (${r.status})`;
  return s.slice(0, 500);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const a = new URL(req.url).searchParams.get('a') ?? '';
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const asMember = createClient(SB_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: who } = await asMember.auth.getUser(jwt);
  const uid = who?.user?.id;
  if (!uid) return json({ error: 'Please sign in again.' }, 401);
  const db = admin();

  // ── Players ────────────────────────────────────────────────────────────
  if (a === 'sso-url') return json({ url: SSO_BASE + btoa(KEY), env: ENV });

  if (a === 'status') {
    const { data: l } = await db.from('dupr_links').select('dupr_id, rating_doubles, rating_singles, entitlements, entitlements_checked_at, basic_info, connected_at').eq('user_id', uid).eq('env', ENV).maybeSingle();
    if (!l) return json({ connected: false, env: ENV });
    return json({ connected: true, env: ENV, dupr_id: l.dupr_id, doubles: l.rating_doubles, singles: l.rating_singles, eligible: hasBasic(l.entitlements), checked_at: l.entitlements_checked_at, name: l.basic_info?.fullName ?? null, connected_at: l.connected_at });
  }

  if (a === 'connect' && req.method === 'POST') {
    const e = await req.json().catch(() => ({}));
    const access = e.userToken ?? e.accessToken, refresh = e.refreshToken ?? null;
    const duprId = String(e.duprId ?? '');
    if (!access || !/^[A-Z0-9]{6}$/.test(duprId)) return json({ error: 'DUPR did not send the connection. Please try again.' }, 400);
    // Check the token really belongs to this DUPR account before trusting it.
    const me = await asUser('/public/user/info', access);
    const meId = me.body?.result?.duprId ?? me.body?.duprId ?? null;
    if (me.status === 401 || me.status === 403 || (me.status === 200 && meId && String(meId) !== duprId)) {
      return json({ error: 'Could not confirm this DUPR account. Please try again.' }, 400);
    }
    const { data: other } = await db.from('dupr_links').select('user_id').eq('dupr_id', duprId).maybeSingle();
    if (other?.user_id && other.user_id !== uid) return json({ error: `You logged in to DUPR as ${duprId}, and that DUPR account is already connected to another Match Day Pickle member. If you meant a different DUPR account, log out on DUPR's page and log in with that one.` }, 409);
    await db.from('dupr_links').delete().eq('user_id', uid).eq('env', ENV).neq('dupr_id', duprId);
    const info = await partner(`/user/v1.0/${duprId}`);
    const res = info.body?.result ?? null;
    const clubs = await asUser('/user/club/membership', access);
    const doubles = num(e.stats?.doubles) ?? num(res?.ratings?.doubles), singles = num(e.stats?.singles) ?? num(res?.ratings?.singles);
    const { error } = await db.from('dupr_links').upsert({
      dupr_id: duprId, dupr_numeric_id: String(e.id ?? ''), user_id: uid, env: ENV, access_token: access, refresh_token: refresh,
      stats: e.stats ?? null, entitlements: e.subscriptions ?? null, entitlements_checked_at: new Date().toISOString(), basic_info: res,
      clubs: clubs.status === 200 ? (clubs.body?.result ?? clubs.body) : null, rating_doubles: doubles, rating_singles: singles,
      connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    if (error) return json({ error: 'Could not save the connection.' }, 500);
    await partner('/user/v1.0/subscribe/webhook-event', 'POST', { duprIds: [duprId], topic: 'RATING' });
    if (PROD) {
      await db.from('profiles').update({ dupr_short_id: duprId, dupr_id: String(e.id ?? duprId), dupr_doubles: doubles, dupr_singles: singles, dupr_updated_at: new Date().toISOString() }).eq('id', uid);
    }
    return json({ ok: true, env: ENV, dupr_id: duprId, doubles, singles, eligible: hasBasic(e.subscriptions), name: res?.fullName ?? null });
  }

  if (a === 'disconnect' && req.method === 'POST') {
    const { data: l } = await db.from('dupr_links').select('dupr_id').eq('user_id', uid).eq('env', ENV).maybeSingle();
    if (l) {
      await partner('/user/v1.0/subscribe/webhook-event', 'DELETE', { duprIds: [l.dupr_id], topic: 'RATING' });
      await db.from('dupr_links').delete().eq('dupr_id', l.dupr_id);
      if (PROD) await db.from('profiles').update({ dupr_short_id: null, dupr_id: null, dupr_doubles: null, dupr_singles: null, dupr_updated_at: new Date().toISOString() }).eq('id', uid);
    }
    return json({ ok: true });
  }

  // ── Admins ─────────────────────────────────────────────────────────────
  // Warm the DUPR token while the checks below run.
  const tokenReady = partnerToken().catch(() => null);
  const [{ data: isAdmin }, club, { data: mine }] = await Promise.all([
    asMember.rpc('is_club_admin'),
    clubId(db),
    db.from('dupr_links').select('dupr_id, clubs').eq('user_id', uid).eq('env', ENV).maybeSingle(),
  ]);
  await tokenReady;
  if (!isAdmin) return json({ error: 'Admins only.' }, 403);
  if (!club) return json({ error: 'The DUPR club is not set up yet.' }, 400);
  // DUPR rule: only a DIRECTOR or ORGANIZER of the club may send its results.
  const role = roleIn(mine?.clubs, club);
  if (!mine) return json({ error: 'Connect your own DUPR account first (Profile → Connect DUPR).' }, 403);
  if (role !== 'DIRECTOR' && role !== 'ORGANIZER') return json({ error: 'Your DUPR account needs to be a director or organizer of the Match Day Pickle club on DUPR to send results.' }, 403);

  // DUPR never reuses an identifier, even after a match is deleted, so each new attempt
  // for the same game gets the next suffix: mdp-<id>, mdp-<id>-2, mdp-<id>-3 …
  const nextIdentifier = async (recordId: string) => {
    const { count } = await db.from('dupr_matches').select('identifier', { count: 'exact', head: true }).eq('record_id', recordId);
    return count ? `mdp-${recordId}-${count + 1}` : `mdp-${recordId}`;
  };
  // Create one match on DUPR and record it. Returns the match code, or the reason it failed.
  const createMatch = async (recordId: string, body: any): Promise<{ code: string | null; err: string | null }> => {
    const r = await partner('/match/v1.0/create', 'POST', body);
    const code = r.body?.result?.matchCode ?? null;
    if (code) console.log('dupr create', r.status, JSON.stringify(r.body?.result).slice(0, 300));
    const err = code ? null : why(r);
    await db.from('dupr_matches').insert({ identifier: body.identifier, record_id: recordId, match_code: code, club_id: club, request: { ...body, _result: r.body?.result ?? null }, status: code ? 'sent' : 'failed', error: err, sent_at: new Date().toISOString() });
    return { code: code ? String(code) : null, err };
  };

  if (a === 'send-session' && req.method === 'POST') {
    const { session_id } = await req.json().catch(() => ({}));
    const { data: rows, error } = await asMember.rpc('dupr_csv_rows', { p_session: session_id });
    if (error) return json({ error: error.message }, 400);
    const sess = rows?.session ?? {};
    const games: any[] = rows?.games ?? [];
    // On DUPR's test system only demo sessions go out, so a demo can never mark a real
    // member's game as sent (several real accounts are linked to DUPR test accounts).
    if (!PROD && !/\b(demo|test)\b/i.test(String(sess.label ?? ''))) {
      return json({ error: 'This is connected to DUPR\'s test system. Only sessions with "Demo" or "Test" in the name can be sent.' }, 400);
    }
    const profileIds = [...new Set(games.flatMap((g) => (g.seats ?? []).map((s: any) => s?.profile_id).filter(Boolean)))];
    const { data: links } = await db.from('dupr_links').select('user_id, dupr_id, entitlements').eq('env', ENV).in('user_id', profileIds.length ? profileIds : ['00000000-0000-0000-0000-000000000000']);
    const byUser = new Map<string, any>((links ?? []).map((l: any) => [l.user_id, l]));
    const sent: unknown[] = [], held: unknown[] = [];
    const sendOne = async (g: any) => {
      const seats: any[] = (g.seats ?? []).filter(Boolean);
      const ids = seats.map((s) => byUser.get(s.profile_id)?.dupr_id ?? null);
      const notReady = seats.filter((s) => !byUser.get(s.profile_id)).map((s) => s.name);
      const notEligible = seats.filter((s) => byUser.get(s.profile_id) && !hasBasic(byUser.get(s.profile_id)?.entitlements)).map((s) => s.name);
      if (notReady.length || notEligible.length || seats.length < (g.format === 'singles' ? 2 : 4)) {
        held.push({ id: g.id, needs_connect: notReady, not_eligible: notEligible });
        return;
      }
      const { data: prior } = await db.from('dupr_matches').select('match_code, status').eq('record_id', g.id);
      const live = (prior ?? []).find((p: any) => p.status === 'sent');
      if (live) { sent.push({ id: g.id, match_code: live.match_code, already: true }); return; }
      const doubles = g.format !== 'singles';
      const body = {
        identifier: await nextIdentifier(g.id), event: sess.label ?? 'Match Day Pickle open play', bracket: 'Open play', location: sess.venue ?? 'Philippines',
        matchDate: sess.session_date ?? today(), format: doubles ? 'DOUBLES' : 'SINGLES', matchType: 'SIDEOUT',
        matchSource: 'CLUB', clubId: club, matchPlayType: 'RECREATIONAL', matchCompletionType: 'COMPLETED',
        teamA: doubles ? { player1: ids[0], player2: ids[1], game1: g.score_a } : { player1: ids[0], game1: g.score_a },
        teamB: doubles ? { player1: ids[2], player2: ids[3], game1: g.score_b } : { player1: ids[1], game1: g.score_b },
      };
      const { code, err } = await createMatch(g.id, body);
      if (code) {
        await db.from('match_records').update({ status: 'submitted', submitted_at: new Date().toISOString(), dupr_match_id: code, admin_notes: 'Sent to DUPR' + (PROD ? '' : ' (test system)') }).eq('id', g.id);
        sent.push({ id: g.id, match_code: code });
      } else held.push({ id: g.id, error: err });
    };
    // Five at a time: a full night of games goes in seconds rather than one by one.
    for (let i = 0; i < games.length; i += 5) await Promise.all(games.slice(i, i + 5).map(sendOne));
    return json({ ok: true, env: ENV, sent: sent.length, held, details: sent });
  }

  if ((a === 'remove-match' || a === 'update-match') && req.method === 'POST') {
    const { record_id, score_a, score_b } = await req.json().catch(() => ({}));
    const { data: m } = await db.from('dupr_matches').select('identifier, match_code, request, status').eq('record_id', record_id).eq('status', 'sent').order('sent_at', { ascending: false }).limit(1).maybeSingle();
    if (!m?.match_code) return json({ error: 'This game is not on DUPR.' }, 404);
    const identifier = m.identifier;
    const removeOnDupr = () => partner('/match/v1.0/delete', 'DELETE', { matchCode: m.match_code, identifier });
    if (a === 'remove-match') {
      const r = await removeOnDupr();
      if (r.status >= 300) return json({ error: r.body?.message ?? 'DUPR did not remove it.' }, 502);
      await Promise.all([
        db.from('dupr_matches').update({ status: 'deleted', deleted_at: new Date().toISOString() }).eq('identifier', identifier),
        db.from('match_records').update({ status: 'approved', dupr_match_id: null, admin_notes: 'Removed from DUPR' }).eq('id', record_id),
      ]);
      return json({ ok: true });
    }
    const okScore = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 99;
    if (!okScore(score_a) || !okScore(score_b) || score_a === score_b) return json({ error: 'Enter both scores (they cannot be equal).' }, 400);
    const req0: any = m.request ?? {};
    const teamA = { ...req0.teamA, game1: score_a }, teamB = { ...req0.teamB, game1: score_b };
    const { data: who2 } = await db.from('profiles').select('full_name').eq('id', uid).single();
    const by = who2?.full_name ?? 'admin';

    // 1) Ask DUPR to change the score on the existing match. DUPR's update takes its own match
    //    ID, which comes back when the match is created; older games only have the match code.
    const matchId = num(req0._result?.id) ?? num(req0._result?.matchId) ?? num(m.match_code);
    const upd = { matchId, ...pick(req0, MATCH_FIELDS), teamA, teamB };
    const r = await partner('/match/v1.0/update', 'POST', upd);
    console.log('dupr update', r.status, why(r));
    if (r.status < 300) {
      await Promise.all([
        db.from('match_records').update({ team_a_score: score_a, team_b_score: score_b, admin_notes: `Score fixed on DUPR by ${by}` }).eq('id', record_id),
        db.from('dupr_matches').update({ request: { ...req0, teamA, teamB } }).eq('identifier', identifier),
      ]);
      return json({ ok: true, method: 'update' });
    }

    // 2) If DUPR won't update it, replace it: remove the old match and send the corrected one.
    const del = await removeOnDupr();
    if (del.status >= 300) return json({ error: `DUPR did not accept the change (${why(r)}).` }, 502);
    await db.from('dupr_matches').update({ status: 'deleted', deleted_at: new Date().toISOString() }).eq('identifier', identifier);
    const fresh = { ...pick(req0, MATCH_FIELDS), matchPlayType: req0.matchPlayType, matchCompletionType: req0.matchCompletionType ?? 'COMPLETED', identifier: await nextIdentifier(record_id), teamA, teamB };
    const { code, err } = await createMatch(record_id, fresh);
    if (!code) {
      await db.from('match_records').update({ status: 'approved', dupr_match_id: null, team_a_score: score_a, team_b_score: score_b, admin_notes: `Removed from DUPR to fix the score; resend failed: ${err}` }).eq('id', record_id);
      return json({ error: `The old score was removed from DUPR, but the corrected game didn't go through (${err}). Send it again from this screen.` }, 502);
    }
    await db.from('match_records').update({ status: 'submitted', dupr_match_id: code, team_a_score: score_a, team_b_score: score_b, admin_notes: `Score fixed on DUPR by ${by} (replaced)` }).eq('id', record_id);
    return json({ ok: true, method: 'replaced', match_code: code });
  }

  return json({ error: 'Unknown action' }, 400);
});
