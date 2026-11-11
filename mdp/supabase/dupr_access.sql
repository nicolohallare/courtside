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
  select coalesce(s.dupr_access, case when s.label ilike '%dupr%' or coalesce(s.notes, '') ilike '%dupr%' then 'BASIC_L1' end)
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

-- Demo: DUPR Demo needs a DUPR account; a DUPR+ Night next Thursday shows the DUPR+ gate.
update sessions set dupr_access = 'BASIC_L1' where label = 'DUPR Demo';
insert into sessions
select (jsonb_populate_record(null::sessions, to_jsonb(s) || jsonb_build_object(
  'id', gen_random_uuid(), 'label', 'DUPR+ Night', 'dupr_access', 'PREMIUM_L1',
  'session_date', '2026-11-19', 'notes', 'For DUPR+ members: verified, paying DUPR accounts only.',
  'created_at', now()))).*
from sessions s where s.label = 'DUPR Demo' and not exists (select 1 from sessions where label = 'DUPR+ Night')
limit 1;

select label, session_date, session_dupr_need(id) as needs from sessions where label in ('DUPR Demo', 'DUPR+ Night');
