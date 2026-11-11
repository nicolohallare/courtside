-- MDP app v2 launch: everything the new app needs on the live database, in one go.
-- Built from court_board.sql, dupr_access.sql, groups.sql, admin.sql and booking_windows.sql
-- (demo-only sample data left out). Safe to run twice. The old app keeps working, except
-- that its DUPR-night board is replaced by the new one.
--
-- DUPR rules stay off until production DUPR is connected:
--   update app_config set value = 'on' where key = 'dupr_gate';
--   update app_config set value = 'prod' where key = 'dupr_env';

insert into app_config (key, value) values ('dupr_gate', 'off') on conflict (key) do nothing;

-- ── Court board ──
-- Court board for the new app: players check themselves in, see their place in the queue
-- and their court; fixed partners stay together; open play can finish a game without a score.
-- Builds on the existing DUPR-night board (dupr_sheet_players, dupr_live_games, dupr_board_*).
-- Applied to the demo database first. Port to live with the app switch.

alter table dupr_sheet_players add column if not exists partner_id uuid references dupr_sheet_players(id) on delete set null;

create or replace function _board_member(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_club_admin() or exists (select 1 from registrations r
    where r.session_uuid = p_session and r.user_id = auth.uid() and r.status in ('paid', 'pending'));
$$;

create or replace function _board_today(p_session uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare d date; c boolean; today date := (now() at time zone 'Asia/Manila')::date;
begin
  select session_date, coalesce(is_cancelled, false) into d, c from sessions where id = p_session;
  if d is null then raise exception 'Session not found'; end if;
  if c then raise exception 'That session was cancelled'; end if;
  if d > today then raise exception 'Check-in opens on %', to_char(d, 'FMDy, FMMon FMDD'); end if;
  if d < today - 1 then raise exception 'That session is over'; end if;
end $$;

-- Sessions on the board now (today, or last night until midnight passes) that I'm booked into or run.
create or replace function board_tonight() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'label', s.label, 'venue', s.venue, 'session_date', s.session_date,
    'time_start', s.time_start, 'time_end', s.time_end, 'courts', coalesce(s.courts, 3),
    'is_dupr', is_dupr_session(s.id), 'is_admin', is_club_admin(),
    'booked', exists (select 1 from registrations r where r.session_uuid = s.id and r.user_id = auth.uid() and r.status in ('paid','pending')),
    'players', (select count(*) from dupr_sheet_players sp where sp.session_id = s.id and sp.status in ('here','playing','resting'))
  ) order by s.session_date desc, s.time_start), '[]'::jsonb)
  from sessions s
  where coalesce(s.is_cancelled, false) = false and coalesce(s.session_type, 'open_play') <> 'coaching'
    and s.session_date between (now() at time zone 'Asia/Manila')::date - 1 and (now() at time zone 'Asia/Manila')::date
    and _board_member(s.id);
$$;

-- My row on the sheet, created from my booking if the host hasn't opened the board yet.
create or replace function _board_my_row(p_session uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; reg record;
begin
  select id into rid from dupr_sheet_players where session_id = p_session and profile_id = auth.uid();
  if rid is not null then return rid; end if;
  select r.id, coalesce(nullif(trim(p.full_name), ''), r.player_name, 'Player') nm, p.dupr_short_id, p.dupr_doubles
    into reg from registrations r join profiles p on p.id = r.user_id
   where r.session_uuid = p_session and r.user_id = auth.uid() and r.status in ('paid', 'pending')
   order by r.created_at limit 1;
  if reg.id is null then raise exception 'You need a booking for this session to check in'; end if;
  insert into dupr_sheet_players (session_id, profile_id, reg_id, seed_key, name, dupr_short_id, level, added_by)
  values (p_session, auth.uid(), reg.id, 'u:' || auth.uid(), reg.nm, reg.dupr_short_id, _dupr_level_for(reg.dupr_doubles), auth.uid())
  on conflict do nothing;
  perform _dupr_sheet_number(p_session);
  select id into rid from dupr_sheet_players where session_id = p_session and profile_id = auth.uid();
  return rid;
end $$;

-- here / resting / out for one sheet row, without the admin check (callers check).
create or replace function _board_set(p_player uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare rec dupr_sheet_players;
begin
  select * into rec from dupr_sheet_players where id = p_player for update;
  if rec.status = 'playing' then raise exception 'You''re on court. Finish the game first'; end if;
  if p_status = 'here' then
    update dupr_sheet_players set status = 'here', arrived_at = coalesce(arrived_at, now()),
      stack = case when rec.status = 'resting' and rec.stack is not null then rec.stack else _dupr_arrival_stack(rec.session_id, rec.level) end,
      queued_at = case when rec.status = 'resting' and rec.queued_at is not null then rec.queued_at else now() end,
      hidden = false
    where id = p_player;
  else
    update dupr_sheet_players set status = p_status,
      queued_at = case when p_status = 'resting' then queued_at else null end
    where id = p_player;
  end if;
end $$;

-- Player: I'm here / taking a break / leaving for the night.
create or replace function board_check_in(p_session uuid, p_status text default 'here') returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_status not in ('here', 'resting', 'out') then raise exception 'Unknown status'; end if;
  perform _board_today(p_session);
  rid := _board_my_row(p_session);
  perform _board_set(rid, p_status);
  if p_status = 'out' then
    update dupr_sheet_players set partner_id = null where id = rid or partner_id = rid;
  end if;
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

-- Fixed partners: two checked-in players who want to stay on the same team.
-- Either player (or an admin) can split them again at any time.
create or replace function board_partner(p_session uuid, p_a uuid, p_b uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a dupr_sheet_players; b dupr_sheet_players; mine uuid;
begin
  perform _board_today(p_session);
  if not is_club_admin() then
    mine := _board_my_row(p_session);
    if p_a is distinct from mine then raise exception 'You can only change your own partner'; end if;
  end if;
  select * into a from dupr_sheet_players where id = p_a and session_id = p_session for update;
  if a.id is null then raise exception 'Player not found'; end if;
  -- split
  update dupr_sheet_players set partner_id = null where id in (a.id, a.partner_id) or partner_id = a.id;
  if p_b is null then return jsonb_build_object('ok', true); end if;
  select * into b from dupr_sheet_players where id = p_b and session_id = p_session for update;
  if b.id is null or b.id = a.id then raise exception 'Pick someone else'; end if;
  if b.partner_id is not null then raise exception '% already has a partner tonight', b.name; end if;
  if b.status not in ('here', 'resting', 'playing') then raise exception '% hasn''t checked in yet', b.name; end if;
  update dupr_sheet_players set partner_id = b.id where id = a.id;
  update dupr_sheet_players set partner_id = a.id,
    -- the partner joins the queue spot of whoever was waiting longer
    level = coalesce(a.level, b.level), stack = case when a.status = 'here' and b.status = 'here' then a.stack else b.stack end,
    queued_at = case when a.status = 'here' and b.status = 'here' then least(a.queued_at, b.queued_at) else b.queued_at end
  where id = b.id;
  update dupr_sheet_players set queued_at = (select queued_at from dupr_sheet_players where id = b.id)
   where id = a.id and status = 'here' and b.status = 'here';
  return jsonb_build_object('ok', true);
end $$;

-- Open play: end a game by tapping the side that won. No score, nothing goes to DUPR.
create or replace function board_finish_quick(p_live uuid, p_winner text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lg dupr_live_games; w uuid[]; l uuid[];
begin
  select * into lg from dupr_live_games where id = p_live for update;
  if lg.id is null then raise exception 'That game already ended. Refresh'; end if;
  perform _dupr_board_guard(lg.session_id);
  if p_winner not in ('A', 'B') then raise exception 'Pick the side that won'; end if;
  delete from dupr_live_games where id = lg.id;
  if p_winner = 'A' then w := lg.seats[1:2]; l := lg.seats[3:4]; else w := lg.seats[3:4]; l := lg.seats[1:2]; end if;
  update dupr_sheet_players set status = 'here', stack = 'W', queued_at = now() where id = any(w) and status = 'playing';
  update dupr_sheet_players set status = 'here', stack = 'L', queued_at = now() where id = any(l) and status = 'playing';
  return jsonb_build_object('ok', true, 'court', lg.court);
end $$;

-- Everything the Courts screen shows. Players see the board of a session they're booked into.
create or replace function board_view(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sess record; today date := (now() at time zone 'Asia/Manila')::date; me uuid;
begin
  if not _board_member(p_session) then raise exception 'Book this session to see its court board'; end if;
  select id, label, venue, session_date, time_start, time_end, coalesce(courts, 3) courts into sess from sessions where id = p_session;
  select id into me from dupr_sheet_players where session_id = p_session and profile_id = auth.uid();
  return jsonb_build_object(
    'session', jsonb_build_object('id', sess.id, 'label', sess.label, 'venue', sess.venue, 'session_date', sess.session_date,
      'time_start', sess.time_start, 'time_end', sess.time_end, 'courts', sess.courts, 'is_dupr', is_dupr_session(p_session),
      'board_open', sess.session_date between today - 1 and today, 'is_admin', is_club_admin(), 'server_now', now(), 'me', me),
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', sp.id, 'ref_no', sp.ref_no, 'name', coalesce(nullif(trim(p.full_name), ''), sp.name),
        'rating', p.dupr_doubles, 'linked', p.dupr_id is not null, 'level', sp.level, 'stack', sp.stack, 'status', sp.status,
        'queued_at', sp.queued_at, 'partner_id', sp.partner_id, 'hidden', sp.hidden,
        'games', (select count(*) from match_records m where m.session_id = p_session
                   and m.status in ('pending_review','approved','submitted','needs_dupr') and sp.id = any(coalesce(m.sheet_seats, '{}'::uuid[])))
      ) order by sp.ref_no nulls last), '[]'::jsonb)
      from dupr_sheet_players sp left join profiles p on p.id = sp.profile_id where sp.session_id = p_session and not sp.hidden),
    'live', (select coalesce(jsonb_agg(jsonb_build_object('id', lg.id, 'court', lg.court, 'game_no', lg.game_no,
        'started_at', lg.started_at, 'seats', to_jsonb(lg.seats)) order by lg.court), '[]'::jsonb)
      from dupr_live_games lg where lg.session_id = p_session),
    'games', (select coalesce(jsonb_agg(g order by (g->>'game_no')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('id', m.id, 'game_no', m.game_no, 'court', m.court, 'score_a', m.team_a_score, 'score_b', m.team_b_score,
          'status', m.status, 'seats', to_jsonb(m.sheet_seats)) g
        from match_records m where m.session_id = p_session and m.sheet_seats is not null
          and m.status in ('pending_review','approved','submitted','needs_dupr')) q)
  );
end $$;

revoke all on function _board_member(uuid), _board_today(uuid), _board_my_row(uuid), _board_set(uuid, text) from public, anon, authenticated;
revoke all on function board_tonight(), board_check_in(uuid, text), board_partner(uuid, uuid, uuid), board_finish_quick(uuid, text), board_view(uuid) from public, anon;
grant execute on function board_tonight(), board_check_in(uuid, text), board_partner(uuid, uuid, uuid), board_finish_quick(uuid, text), board_view(uuid) to authenticated;

-- ── DUPR standing ──

-- A player's DUPR standing: connected?, rating, entitlement level. Only links made on the DUPR
-- system in use count (app_config dupr_env), so test-system links don't pass for production.
create or replace function _t_dupr(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'connected', l.dupr_id is not null,
    'dupr_id', l.dupr_id,
    'rating', coalesce(l.rating_doubles, p.dupr_doubles),
    'level', case when l.entitlements::text like '%PREMIUM_L1%' then 'PREMIUM_L1'
                  when l.entitlements::text like '%BASIC_L1%' then 'BASIC_L1' end)
  from profiles p
  left join lateral (select * from dupr_links x where x.user_id = p.id
    and x.env = coalesce((select value from app_config where key = 'dupr_env'), x.env)
    order by x.updated_at desc limit 1) l on true
  where p.id = p_user;
$$;
revoke all on function _t_dupr(uuid) from public, anon, authenticated;

-- ── DUPR access ──
-- DUPR access for open play (asked for by DUPR, Nov 11 call with Haresh).
--
--   * A session can require a DUPR account (BASIC_L1) or DUPR+ (PREMIUM_L1): sessions.dupr_access.
--     A session with "DUPR" in its name or notes needs at least a connected DUPR account.
--   * Checked when a player books (registrations trigger) and again at check-in on the court board.
--   * DUPR's own entitlements decide, as saved when the player connected DUPR in the app.
--   * Check-in is a hard block (DUPR, Nov 11): no DUPR account, no play. No admin override.
-- Tournaments already check per division (divisions[].requires = 'PREMIUM_L1').

alter table sessions add column if not exists dupr_access text check (dupr_access in ('BASIC_L1', 'PREMIUM_L1'));
alter table dupr_sheet_players add column if not exists dupr_override_by uuid;

-- What a session asks of players: null, 'BASIC_L1' or 'PREMIUM_L1'.
create or replace function session_dupr_need(p_session uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when coalesce((select value from app_config where key = 'dupr_gate'), 'off') = 'on' then
    coalesce(s.dupr_access, case when s.label ilike '%dupr%' or coalesce(s.notes, '') ilike '%dupr%' then 'BASIC_L1' end) end
  from sessions s where s.id = p_session;
$$;

-- Why a player can't join: null (fine), 'connect' (no DUPR, or DUPR says the account isn't active) or 'plus'.
create or replace function _dupr_gap(p_user uuid, p_need text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_need is null then null
    when p_user is null then 'connect'
    when coalesce((d->>'connected')::boolean, false) = false or d->>'level' is null then 'connect'
    when p_need = 'PREMIUM_L1' and d->>'level' <> 'PREMIUM_L1' then 'plus'
  end
  from (select _t_dupr(p_user) d) x;
$$;

-- Booking.
create or replace function session_dupr_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare need text; gap text;
begin
  if coalesce(current_setting('mdp.skip_dupr_gate', true), '') = 'on' then return new; end if;
  need := session_dupr_need(new.session_uuid);
  if need is null then return new; end if;
  if new.guest_name is not null and trim(new.guest_name) <> '' then
    raise exception 'Guests can''t join this session: every player needs %.', case need when 'PREMIUM_L1' then 'DUPR+' else 'their own DUPR account' end;
  end if;
  gap := _dupr_gap(new.user_id, need);
  if gap = 'connect' then
    raise exception 'This session needs a DUPR account. Connect DUPR in Me, then book.';
  elsif gap = 'plus' then
    raise exception 'This session is for DUPR+ members. If you joined DUPR+ recently, disconnect and connect DUPR again in Me so we see it.';
  end if;
  return new;
end $$;

drop trigger if exists session_dupr_gate on registrations;
create trigger session_dupr_gate before insert on registrations for each row execute function session_dupr_gate();

-- Check-in. p_self: the player is checking themselves in. p_force: an admin lets them play anyway.
create or replace function _board_gate(p_player uuid, p_self boolean, p_force boolean) returns void
language plpgsql security definer set search_path = public as $$
declare rec dupr_sheet_players; need text; gap text;
begin
  -- DUPR (Nov 11): a hard block. Everyone who checks in to a DUPR session needs a connected DUPR
  -- account, and DUPR+ for a DUPR+ session. No admin override; p_force is ignored.
  select * into rec from dupr_sheet_players where id = p_player;
  need := session_dupr_need(rec.session_id);
  gap := _dupr_gap(rec.profile_id, need);
  if gap is null then return; end if;
  if gap = 'plus' or need = 'PREMIUM_L1' then
    raise exception '%', case when p_self
      then 'Tonight is for DUPR+ members. If you joined DUPR+ recently, open Me and tap Check DUPR+ again.'
      else rec.name || ' doesn''t have DUPR+, and tonight is for DUPR+ members.' end;
  end if;
  raise exception '%', case when p_self
    then 'Connect DUPR in Me to check in. It takes a couple of minutes, and you can create a free DUPR account there too.'
    else rec.name || ' needs to connect DUPR before playing tonight. They can do it in the app under Me in a couple of minutes.' end;
end $$;

create or replace function board_check_in(p_session uuid, p_status text default 'here') returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_status not in ('here', 'resting', 'out') then raise exception 'Unknown status'; end if;
  perform _board_today(p_session);
  rid := _board_my_row(p_session);
  if p_status = 'here' then perform _board_gate(rid, true, false); end if;
  perform _board_set(rid, p_status);
  if p_status = 'out' then
    update dupr_sheet_players set partner_id = null where id = rid or partner_id = rid;
  end if;
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

drop function if exists dupr_board_status(uuid, text);
create or replace function dupr_board_status(p_player uuid, p_status text, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rec dupr_sheet_players;
begin
  select * into rec from dupr_sheet_players where id = p_player for update;
  if rec.id is null then raise exception 'Player not found'; end if;
  perform _dupr_board_guard(rec.session_id);
  if p_status not in ('here','resting','no_show','out') then raise exception 'Unknown status'; end if;
  if rec.status = 'playing' then raise exception '% is on court — finish or cancel that game first', rec.name; end if;
  if p_status = 'here' then
    if rec.status in ('out', 'no_show') then perform _board_gate(p_player, false, p_force); end if;
    update dupr_sheet_players set
      status = 'here',
      arrived_at = coalesce(arrived_at, now()),
      stack = case when rec.status = 'resting' and rec.stack is not null then rec.stack
                   else _dupr_arrival_stack(rec.session_id, rec.level) end,
      queued_at = now(),
      hidden = false
    where id = p_player;
  else
    update dupr_sheet_players set status = p_status,
      arrived_at = case when p_status = 'out' then null else arrived_at end,
      queued_at = case when p_status = 'resting' then queued_at else null end
    where id = p_player;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- For the app: what each upcoming session asks, and what DUPR says about me.
create or replace function session_dupr_needs() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(s.id, session_dupr_need(s.id)) filter (where session_dupr_need(s.id) is not null), '{}'::jsonb)
  from sessions s where s.session_date >= (now() at time zone 'Asia/Manila')::date - 1;
$$;

create or replace function my_dupr_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select _t_dupr(auth.uid());
$$;

revoke all on function session_dupr_need(uuid), _dupr_gap(uuid, text), _board_gate(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function board_check_in(uuid, text), dupr_board_status(uuid, text, boolean), session_dupr_needs(), my_dupr_access() from public, anon;
grant execute on function board_check_in(uuid, text), dupr_board_status(uuid, text, boolean), session_dupr_needs(), my_dupr_access() to authenticated;


-- ── Court groups (Chris's format) ──
-- Court groups (Chris's format, agreed Nov 11 2026) and scores entered by players.
--
-- Two phases (Chris, after the Nov 10 DUPR night: an open court pulled players off their own court):
--   1. Strict courts: tonight's players are split by DUPR into one group per court (3 courts = top,
--      middle and bottom), and each group plays only on its own court. Late arrivals join the group
--      their rating fits. A host can move anyone with a tap.
--   2. Free for all: the host switches when it's time (e.g. the last 1.5 hours at Pickle Drop) and
--      every court takes the next four from one shared line. The host can switch back.
--   * Players choose partners: a pair waits in line together and goes on court together.
--   * Winners stay for ONE more game and split up (each winner partners someone new from the line);
--     after that second game they go back in line. Losers go to the back of the line.
--
-- Scores: one of the four players enters the score; someone from the OTHER team confirms it, and the
-- game is recorded and the next game starts. Either team can correct the score before it is confirmed
-- (the other side then confirms). Hosts can enter or confirm any score.
-- DUPR (Nov 11): players only enter and confirm; a club director or organizer submits to DUPR.

alter table sessions add column if not exists board_format text not null default 'groups' check (board_format in ('groups', 'levels'));
alter table sessions add column if not exists board_phase text not null default 'strict' check (board_phase in ('strict', 'free'));
alter table dupr_sheet_players add column if not exists grp smallint;
alter table dupr_sheet_players add column if not exists line smallint;
alter table dupr_sheet_players add column if not exists streak smallint not null default 0;
alter table dupr_live_games add column if not exists rep_a smallint;
alter table dupr_live_games add column if not exists rep_b smallint;
alter table dupr_live_games add column if not exists rep_by uuid;
alter table dupr_live_games add column if not exists rep_at timestamptz;

create or replace function _groups_count(p_session uuid) returns int
language sql stable security definer set search_path = public as $$
  select greatest(coalesce(courts, 3), 1) from sessions where id = p_session;
$$;
-- No open court any more (kept so older screens and calls keep working).
create or replace function _open_court(p_session uuid) returns int
language sql stable security definer set search_path = public as $$ select null::int; $$;
-- The line a court takes players from: its own group's line, or the shared line (0) in free for all.
create or replace function _line_for(p_session uuid, p_court int) returns int
language sql stable security definer set search_path = public as $$
  select case when board_phase = 'free' then 0 else p_court end from sessions where id = p_session;
$$;

-- A host switches between strict courts and free for all.
create or replace function board_set_phase(p_session uuid, p_phase text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _dupr_board_guard(p_session);
  if p_phase not in ('strict', 'free') then raise exception 'Unknown phase'; end if;
  update sessions set board_phase = p_phase where id = p_session;
  update dupr_sheet_players set line = case when p_phase = 'free' then 0 else grp end, streak = 0
   where session_id = p_session and status = 'here';
  return jsonb_build_object('ok', true, 'phase', p_phase);
end $$;
create or replace function _sheet_rating(p_player uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(p.dupr_doubles, 0) from dupr_sheet_players sp left join profiles p on p.id = sp.profile_id where sp.id = p_player;
$$;

-- The group a player's rating fits, given the groups already made tonight.
create or replace function _fit_group(p_session uuid, p_player uuid) returns int
language sql stable security definer set search_path = public as $$
  with g as (
    select sp.grp, min(coalesce(p.dupr_doubles, 0)) lo
    from dupr_sheet_players sp left join profiles p on p.id = sp.profile_id
    where sp.session_id = p_session and sp.grp is not null and sp.id <> p_player
    group by sp.grp)
  select coalesce((select min(grp) from g where _sheet_rating(p_player) >= lo), (select max(grp) from g), 1);
$$;

-- Split tonight's checked-in players into groups by DUPR. Hosts only. Running it again re-splits
-- everyone who isn't on court.
create or replace function board_make_groups(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; total int; per int;
begin
  perform _dupr_board_guard(p_session);
  n := _groups_count(p_session);
  select count(*) into total from dupr_sheet_players where session_id = p_session and status in ('here', 'playing', 'resting');
  if total = 0 then raise exception 'Check players in first'; end if;
  per := ceil(total::numeric / n);
  with ranked as (
    select sp.id, row_number() over (order by coalesce(p.dupr_doubles, 0) desc, sp.arrived_at nulls last, sp.ref_no) rn
    from dupr_sheet_players sp left join profiles p on p.id = sp.profile_id
    where sp.session_id = p_session and sp.status in ('here', 'playing', 'resting'))
  update dupr_sheet_players sp set grp = least(n, ((r.rn - 1) / per) + 1)
  from ranked r where r.id = sp.id;
  update dupr_sheet_players set line = grp, queued_at = coalesce(queued_at, now()), streak = 0
   where session_id = p_session and status = 'here';
  update sessions set board_format = 'groups', board_phase = 'strict' where id = p_session;
  return jsonb_build_object('ok', true, 'groups', n, 'players', total);
end $$;

-- Late arrivals: when someone checks in after the groups are made, give them the group their rating fits.
create or replace function _sheet_auto_group() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'here' and coalesce(old.status, '') <> 'here' then
    if new.grp is null and exists (select 1 from dupr_sheet_players where session_id = new.session_id and grp is not null and id <> new.id) then
      new.grp := _fit_group(new.session_id, new.id);
    end if;
    if coalesce(old.status, '') <> 'playing' and new.line is null then
      new.line := case when (select board_phase from sessions where id = new.session_id) = 'free' then 0 else new.grp end;
    end if;
  end if;
  if new.status in ('out', 'no_show', 'resting') then new.line := null; end if;
  return new;
end $$;
drop trigger if exists sheet_auto_group on dupr_sheet_players;
create trigger sheet_auto_group before update of status on dupr_sheet_players for each row execute function _sheet_auto_group();

-- A host moves someone to another group (they keep their place in time, in the new group's line).
create or replace function board_move_group(p_player uuid, p_grp int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rec dupr_sheet_players;
begin
  select * into rec from dupr_sheet_players where id = p_player;
  if rec.id is null then raise exception 'Player not found'; end if;
  perform _dupr_board_guard(rec.session_id);
  if p_grp < 1 or p_grp > _groups_count(rec.session_id) then raise exception 'Pick a group'; end if;
  update dupr_sheet_players set grp = p_grp,
    line = case when line is null or line = 0 then line else p_grp end
   where id = p_player;
  return jsonb_build_object('ok', true);
end $$;

-- A player chooses which line to wait in: their group's court, or the open court.
create or replace function board_join_line(p_session uuid, p_court int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rec dupr_sheet_players;
begin
  select * into rec from dupr_sheet_players where session_id = p_session and profile_id = auth.uid();
  if rec.id is null then raise exception 'Check in first'; end if;
  if rec.status <> 'here' then raise exception 'You can change lines when you''re off court'; end if;
  if p_court is distinct from _line_for(p_session, rec.grp) then
    raise exception 'You wait for your group''s court';
  end if;
  update dupr_sheet_players set line = p_court, queued_at = now() where id = rec.id or (partner_id = rec.id and status = 'here');
  return jsonb_build_object('ok', true);
end $$;

-- The players waiting for a court, in order, as units (a pair counts as one unit of two).
create or replace function _line_units(p_session uuid, p_court int) returns table (ids uuid[], t timestamptz)
language sql stable security definer set search_path = public as $$
  with w as (
    select sp.id, sp.partner_id, sp.queued_at from dupr_sheet_players sp
    where sp.session_id = p_session and sp.status = 'here' and sp.line = p_court)
  select case when q.id is not null and w.id < w.partner_id then array[w.id, w.partner_id]
              when q.id is not null then null else array[w.id] end, greatest(w.queued_at, q.queued_at)
  from w left join w q on q.id = w.partner_id and q.partner_id = w.id
  where not (q.id is not null and w.id > w.partner_id)
  order by 2, 1;
$$;

-- Start a game on a court, from the line (plus winners who stay). Used by hosts and after every game.
create or replace function _groups_start(p_session uuid, p_court int, p_stay uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare u record; need int; picked uuid[] := '{}'; seats uuid[]; i int; gno int; new_id uuid;
begin
  if exists (select 1 from dupr_live_games where session_id = p_session and court = p_court) then return null; end if;
  need := 4 - coalesce(array_length(p_stay, 1), 0);
  for u in select * from _line_units(p_session, _line_for(p_session, p_court)) loop
    exit when coalesce(array_length(picked, 1), 0) >= need;
    if u.ids is null or u.ids && coalesce(p_stay, '{}'::uuid[]) then continue; end if;
    if coalesce(array_length(picked, 1), 0) + array_length(u.ids, 1) <= need then picked := picked || u.ids; end if;
  end loop;
  if coalesce(array_length(picked, 1), 0) < need then return null; end if;
  if coalesce(array_length(p_stay, 1), 0) = 2 then
    seats := array[p_stay[1], picked[1], p_stay[2], picked[2]];   -- winners split: one on each side
  else
    seats := picked;                                              -- pairs from the line stay together
  end if;
  gno := _dupr_next_game(p_session);
  insert into dupr_live_games (session_id, court, game_no, seats, prev_stacks, prev_queued, started_by)
  values (p_session, p_court, gno, seats, array[null, null, null, null]::text[], array[null, null, null, null]::timestamptz[], auth.uid())
  returning id into new_id;
  update dupr_sheet_players set status = 'playing' where id = any(seats);
  return new_id;
end $$;

-- A host fills an empty court from its line.
create or replace function board_next_game(p_session uuid, p_court int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare id uuid;
begin
  perform _dupr_board_guard(p_session);
  id := _groups_start(p_session, p_court, null);
  if id is null then raise exception 'Not enough players waiting for Court %', p_court; end if;
  return jsonb_build_object('ok', true, 'id', id);
end $$;

-- Record a finished game (the same record the host's scoresheet makes), then rotate.
create or replace function _groups_finish(p_live uuid, p_a int, p_b int, p_by uuid, p_confirmed_by uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lg dupr_live_games; win uuid[]; lose uuid[]; stay uuid[] := null; profs uuid[] := array[null, null, null, null]::uuid[];
  i int; who text; new_id uuid; next_id uuid; fmt text := 'doubles';
begin
  select * into lg from dupr_live_games where id = p_live for update;
  if lg.id is null then raise exception 'That game already ended. Refresh'; end if;
  if p_a is null or p_b is null or p_a = p_b or p_a < 0 or p_b < 0 or p_a > 30 or p_b > 30 then raise exception 'Enter both scores (no ties)'; end if;
  for i in 1..4 loop profs[i] := (select profile_id from dupr_sheet_players where id = lg.seats[i]); end loop;
  if lg.seats[2] is null then fmt := 'singles'; end if;
  select string_agg(full_name, ' and ') into who from profiles where id in (p_by, p_confirmed_by);
  insert into match_records (session_id, recorded_by, team_a_p1, team_a_p2, team_b_p1, team_b_p2, sheet_seats, court, game_no,
    team_a_score, team_b_score, format, status, test_mode, reviewed_at, reviewed_by, admin_notes)
  values (lg.session_id, p_by, profs[1], profs[2], profs[3], profs[4], lg.seats, lg.court, lg.game_no,
    p_a, p_b, fmt, 'approved', false, now(), p_confirmed_by,
    case when p_by = p_confirmed_by then 'Entered by ' || coalesce(who, 'a host') else 'Entered and confirmed by ' || coalesce(who, 'players') end)
  returning id into new_id;
  delete from dupr_live_games where id = lg.id;

  if p_a > p_b then win := lg.seats[1:2]; lose := lg.seats[3:4]; else win := lg.seats[3:4]; lose := lg.seats[1:2]; end if;
  -- Losers: back of this court's line.
  update dupr_sheet_players set status = 'here', streak = 0, line = _line_for(lg.session_id, lg.court), queued_at = now(), stack = 'L' where id = any(lose);
  -- Winners: stay for one more game (and split), unless they already stayed once.
  if (select bool_and(streak = 0) from dupr_sheet_players where id = any(win)) and win[2] is not null then
    stay := win;
    update dupr_sheet_players set status = 'here', streak = 1, line = _line_for(lg.session_id, lg.court), stack = 'W' where id = any(win);
  else
    update dupr_sheet_players set status = 'here', streak = 0, line = _line_for(lg.session_id, lg.court), queued_at = now(), stack = 'W' where id = any(win);
  end if;
  next_id := _groups_start(lg.session_id, lg.court, stay);
  if next_id is null and stay is not null then
    -- Not enough players waiting to split the winners: they wait at the front of the line.
    update dupr_sheet_players set streak = 0, queued_at = now() - interval '1 hour' where id = any(stay);
    next_id := _groups_start(lg.session_id, lg.court, null);
  end if;
  return jsonb_build_object('ok', true, 'id', new_id, 'next', next_id);
end $$;

-- A player (or host) enters the score. A host's score is final; a player's waits for the other team.
create or replace function board_report(p_live uuid, p_a int, p_b int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lg dupr_live_games; me uuid; side int;
begin
  select * into lg from dupr_live_games where id = p_live for update;
  if lg.id is null then raise exception 'That game already ended. Refresh'; end if;
  if p_a is null or p_b is null or p_a = p_b or p_a < 0 or p_b < 0 or p_a > 30 or p_b > 30 then raise exception 'Enter both scores (no ties)'; end if;
  if is_club_admin() then return _groups_finish(p_live, p_a, p_b, auth.uid(), auth.uid()); end if;
  select id into me from dupr_sheet_players where session_id = lg.session_id and profile_id = auth.uid();
  side := case when me = any(lg.seats[1:2]) then 1 when me = any(lg.seats[3:4]) then 2 end;
  if side is null then raise exception 'Only the players in this game can enter its score'; end if;
  update dupr_live_games set rep_a = p_a, rep_b = p_b, rep_by = auth.uid(), rep_at = now() where id = p_live;
  return jsonb_build_object('ok', true, 'waiting', true);
end $$;

-- Someone from the other team confirms. That records the game and calls the next one.
create or replace function board_confirm(p_live uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lg dupr_live_games; me uuid; rep uuid; mine int; theirs int;
begin
  select * into lg from dupr_live_games where id = p_live for update;
  if lg.id is null then raise exception 'That game already ended. Refresh'; end if;
  if lg.rep_by is null then raise exception 'No score entered yet'; end if;
  if not is_club_admin() then
    select id into me from dupr_sheet_players where session_id = lg.session_id and profile_id = auth.uid();
    select id into rep from dupr_sheet_players where session_id = lg.session_id and profile_id = lg.rep_by;
    mine := case when me = any(lg.seats[1:2]) then 1 when me = any(lg.seats[3:4]) then 2 end;
    theirs := case when rep = any(lg.seats[1:2]) then 1 when rep = any(lg.seats[3:4]) then 2 end;
    if mine is null then raise exception 'Only the players in this game can confirm its score'; end if;
    if mine = theirs then raise exception 'Someone from the other team confirms the score'; end if;
  end if;
  return _groups_finish(p_live, lg.rep_a, lg.rep_b, lg.rep_by, auth.uid());
end $$;

-- board_view gains the groups, lines and any score waiting for confirmation.
create or replace function board_view(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sess record; today date := (now() at time zone 'Asia/Manila')::date; me uuid;
begin
  if not _board_member(p_session) then raise exception 'Book this session to see its court board'; end if;
  select id, label, venue, session_date, time_start, time_end, coalesce(courts, 3) courts, board_format, board_phase into sess from sessions where id = p_session;
  select id into me from dupr_sheet_players where session_id = p_session and profile_id = auth.uid();
  return jsonb_build_object(
    'session', jsonb_build_object('id', sess.id, 'label', sess.label, 'venue', sess.venue, 'session_date', sess.session_date,
      'time_start', sess.time_start, 'time_end', sess.time_end, 'courts', sess.courts, 'is_dupr', is_dupr_session(p_session),
      'board_open', sess.session_date between today - 1 and today, 'is_admin', is_club_admin(), 'server_now', now(), 'me', me,
      'format', sess.board_format, 'phase', sess.board_phase, 'groups', _groups_count(p_session), 'open_court', _open_court(p_session)),
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', sp.id, 'ref_no', sp.ref_no, 'name', coalesce(nullif(trim(p.full_name), ''), sp.name),
        'rating', p.dupr_doubles, 'linked', p.dupr_id is not null, 'level', sp.level, 'stack', sp.stack, 'status', sp.status,
        'queued_at', sp.queued_at, 'partner_id', sp.partner_id, 'hidden', sp.hidden, 'grp', sp.grp, 'line', sp.line, 'streak', sp.streak,
        'games', (select count(*) from match_records m where m.session_id = p_session
                   and m.status in ('pending_review','approved','submitted','needs_dupr') and sp.id = any(coalesce(m.sheet_seats, '{}'::uuid[])))
      ) order by sp.ref_no nulls last), '[]'::jsonb)
      from dupr_sheet_players sp left join profiles p on p.id = sp.profile_id where sp.session_id = p_session and not sp.hidden),
    'live', (select coalesce(jsonb_agg(jsonb_build_object('id', lg.id, 'court', lg.court, 'game_no', lg.game_no,
        'started_at', lg.started_at, 'seats', to_jsonb(lg.seats), 'rep_a', lg.rep_a, 'rep_b', lg.rep_b,
        'rep_by', (select sp.id from dupr_sheet_players sp where sp.session_id = p_session and sp.profile_id = lg.rep_by),
        'rep_name', (select full_name from profiles where id = lg.rep_by)) order by lg.court), '[]'::jsonb)
      from dupr_live_games lg where lg.session_id = p_session),
    'games', (select coalesce(jsonb_agg(g order by (g->>'game_no')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('id', m.id, 'game_no', m.game_no, 'court', m.court, 'score_a', m.team_a_score, 'score_b', m.team_b_score,
          'status', m.status, 'seats', to_jsonb(m.sheet_seats)) g
        from match_records m where m.session_id = p_session and m.sheet_seats is not null
          and m.status in ('pending_review','approved','submitted','needs_dupr')) q)
  );
end $$;

revoke all on function _line_for(uuid, int), _groups_count(uuid), _open_court(uuid), _sheet_rating(uuid), _fit_group(uuid, uuid), _line_units(uuid, int),
  _groups_start(uuid, int, uuid[]), _groups_finish(uuid, int, int, uuid, uuid) from public, anon, authenticated;
revoke all on function board_set_phase(uuid, text), board_make_groups(uuid), board_move_group(uuid, int), board_join_line(uuid, int), board_next_game(uuid, int),
  board_report(uuid, int, int), board_confirm(uuid) from public, anon;
grant execute on function board_set_phase(uuid, text), board_make_groups(uuid), board_move_group(uuid, int), board_join_line(uuid, int), board_next_game(uuid, int),
  board_report(uuid, int, int), board_confirm(uuid), board_view(uuid) to authenticated;

-- ── Overpayments ──
-- Admin in the new app. Run on the demo first, then on live when the new admin goes out.
--
-- Overpayments: the receipt check already reads the amount sent (registrations.extracted_amount).
-- When a member sent more than they owed, the excess belongs in their wallet. Until now an admin
-- did that by hand (Carlos Cabigao, Nov 10). These list what is still owed and credit it once.

-- An admin can mark one as "not an overpayment" (e.g. the extra paid for a friend outside the app).
create table if not exists overpay_dismissed (reg_id uuid primary key, by_user uuid, note text, at timestamptz default now());
alter table overpay_dismissed enable row level security;

create or replace function admin_overpaid() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'reg_id', r.id, 'user_id', r.user_id, 'player_name', r.player_name, 'session_label', r.session_label,
    'session_date', r.session_date, 'owed', greatest(0, r.amount - coalesce(r.credit_applied, 0)),
    'sent', r.extracted_amount, 'excess', r.extracted_amount - greatest(0, r.amount - coalesce(r.credit_applied, 0)),
    'gcash_ref', r.gcash_ref, 'proof_url', r.proof_url
  ) order by r.created_at desc), '[]'::jsonb)
  from registrations r
  where is_club_admin()
    and r.status = 'paid' and r.user_id is not null and r.paid_by_reg_id is null
    and r.created_at > now() - interval '45 days'
    and r.extracted_amount is not null
    and r.extracted_amount - greatest(0, r.amount - coalesce(r.credit_applied, 0)) >= 1
    -- the payment covers only this booking (a payer's receipt can cover friends' slots too)
    and not exists (select 1 from registrations k where k.paid_by_reg_id = r.id and k.status <> 'cancelled')
    and not exists (select 1 from credits c where c.source_reg_id = r.id and c.amount > 0 and c.reason ilike 'Overpayment%')
    and not exists (select 1 from credits c where c.user_id = r.user_id and c.amount > 0 and r.gcash_ref is not null and c.reason ilike '%' || r.gcash_ref || '%')
    and not exists (select 1 from overpay_dismissed d where d.reg_id = r.id);
$$;

create or replace function admin_dismiss_overpay(p_reg uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_club_admin() then raise exception 'Admins only'; end if;
  insert into overpay_dismissed (reg_id, by_user, note) values (p_reg, auth.uid(), nullif(trim(p_note), ''))
  on conflict (reg_id) do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_credit_overpay(p_reg uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r registrations; owed numeric; extra numeric;
begin
  if not is_club_admin() then raise exception 'Admins only'; end if;
  select * into r from registrations where id = p_reg for update;
  if r.id is null then raise exception 'Booking not found'; end if;
  if r.status <> 'paid' then raise exception 'Approve the payment first'; end if;
  owed := greatest(0, r.amount - coalesce(r.credit_applied, 0));
  extra := coalesce(r.extracted_amount, 0) - owed;
  if extra < 1 then raise exception 'Nothing extra was paid'; end if;
  if exists (select 1 from credits c where c.source_reg_id = r.id and c.amount > 0 and c.reason ilike 'Overpayment%') then
    raise exception 'Already added to % wallet', r.player_name;
  end if;
  insert into credits (user_id, amount, reason, session_id, source_reg_id, created_by)
  values (r.user_id, extra, 'Overpayment: sent ₱' || r.extracted_amount || ' for ' || r.session_label || ' (₱' || owed || ' due)' ||
          coalesce(', GCash ref ' || r.gcash_ref, ''), r.session_uuid, r.id, auth.uid());
  return jsonb_build_object('ok', true, 'amount', extra,
    'balance', (select balance from credit_balances where user_id = r.user_id));
end $$;

revoke all on function admin_overpaid(), admin_credit_overpay(uuid), admin_dismiss_overpay(uuid, text) from public, anon;
grant execute on function admin_overpaid(), admin_credit_overpay(uuid), admin_dismiss_overpay(uuid, text) to authenticated;

-- ── Booking windows: Varsity 2 weeks, Member 5 days, Community 3 days, Flagged 1 hour ──
-- Standard booking windows for every session (agreed Nov 11, 2026).
-- Varsity 2 weeks, Member 5 days, Community 3 days, Flagged 1 hour before the session starts.
-- The new app's session form also writes Varsity and Member opening times from these same numbers;
-- Community and Flagged take the later of the Member opening and their own window (enforce_tier_window).
update app_config set value = case key
  when 'lead_hours_varsity' then '336' when 'lead_hours_member' then '120'
  when 'lead_hours_community' then '72' when 'lead_hours_flagged' then '1' end
where key in ('lead_hours_varsity', 'lead_hours_member', 'lead_hours_community', 'lead_hours_flagged');
