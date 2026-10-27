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
