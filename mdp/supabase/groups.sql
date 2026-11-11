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
