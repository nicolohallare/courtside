-- Levels for players without DUPR. Runs before court_board.sql and groups.sql, which use _eff_rating.
--  * The host's call sticks: when a host sets a level for a player with no DUPR rating, it's saved on
--    their profile and used at every later open play.
--  * First-timers without DUPR say their level once when they first book (self-rated). The host sees
--    "self-rated" and can change it; a host's call can't be overwritten by the player.
--  * A DUPR rating always wins. The saved level only fills in when there's no rating.

alter table profiles add column if not exists play_level text check (play_level in ('N', 'LI', 'HI'));
alter table profiles add column if not exists play_level_src text check (play_level_src in ('host', 'self'));
alter table profiles add column if not exists play_level_at timestamptz;
alter table profiles add column if not exists play_level_by uuid references profiles(id) on delete set null;

-- A stand-in rating for players without DUPR, so groups by rating place them by level instead of last.
create or replace function _eff_rating(p_dupr numeric, p_level text) returns numeric language sql immutable as $$
  select coalesce(p_dupr, case p_level when 'HI' then 3.75 when 'LI' then 3.25 when 'N' then 2.75 end, 0)
$$;

-- The level a profile plays at tonight: from DUPR when there's a rating, else the saved level.
create or replace function _player_level(p_profile uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(_dupr_level_for(p.dupr_doubles), p.play_level) from profiles p where p.id = p_profile
$$;

-- New rows on the court board start at the player's level when nothing set one.
create or replace function _sheet_default_level() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.level is null and new.profile_id is not null then new.level := _player_level(new.profile_id); end if;
  return new;
end $$;
drop trigger if exists sheet_default_level on dupr_sheet_players;
create trigger sheet_default_level before insert on dupr_sheet_players for each row execute function _sheet_default_level();

-- Host moves a player to a level or stack (or to the front). For a player with no DUPR rating,
-- the level is also saved on their profile, so they start there next time.
create or replace function dupr_board_move(p_player uuid, p_level text, p_stack text, p_front boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec dupr_sheet_players; lv text; st text; front timestamptz;
begin
  select * into rec from dupr_sheet_players where id = p_player for update;
  if rec.id is null then raise exception 'Player not found'; end if;
  if not is_club_admin() then raise exception 'Admins only'; end if;
  lv := case when p_level = '' then null when p_level is null then rec.level else p_level end;
  if lv is not null and lv not in ('N','LI','HI') then raise exception 'Unknown level'; end if;
  st := coalesce(p_stack, rec.stack);
  if st is not null and st not in ('W','L') then raise exception 'Unknown stack'; end if;
  if coalesce(p_front, false) then
    select min(queued_at) - interval '1 second' into front from dupr_sheet_players
     where session_id = rec.session_id and status = 'here' and level is not distinct from lv and stack = st;
  end if;
  update dupr_sheet_players set level = lv, stack = st,
    queued_at = case when coalesce(p_front, false) then coalesce(front, now())
                     when rec.status = 'here' and (st is distinct from rec.stack or lv is distinct from rec.level) then now()
                     else queued_at end
  where id = p_player;
  if p_level is not null and p_level <> '' and rec.profile_id is not null then
    update profiles set play_level = lv, play_level_src = 'host', play_level_at = now(), play_level_by = auth.uid()
     where id = rec.profile_id and dupr_doubles is null and play_level is distinct from lv;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- The player says their level (first booking without DUPR, or later from Me). Not when DUPR rates
-- them, and not over a level the host set.
create or replace function set_my_level(p_level text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr profiles;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_level not in ('N', 'LI', 'HI') then raise exception 'Pick a level'; end if;
  select * into pr from profiles where id = auth.uid();
  if pr.dupr_doubles is not null then raise exception 'Your DUPR rating sets your level'; end if;
  if pr.play_level_src = 'host' then raise exception 'A host has set your level. Ask them if you think it should change.'; end if;
  update profiles set play_level = p_level, play_level_src = 'self', play_level_at = now(), play_level_by = auth.uid() where id = auth.uid();
  return jsonb_build_object('ok', true, 'level', p_level);
end $$;

revoke all on function _eff_rating(numeric, text), _player_level(uuid), _sheet_default_level() from public, anon, authenticated;
revoke all on function dupr_board_move(uuid, text, text, boolean), set_my_level(text) from public, anon;
grant execute on function dupr_board_move(uuid, text, text, boolean), set_my_level(text) to authenticated;
