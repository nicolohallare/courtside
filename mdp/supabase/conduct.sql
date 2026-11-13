-- Conduct: players flag a concern privately after a session; admins see a pattern only when
-- several different players flag the same person, and keep a dated log (note, warning, cleared).
-- Players never see flags or who sent them. No public scores.

create table if not exists conduct_flags (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete cascade,
  subject_id uuid not null references profiles(id) on delete cascade,
  reason text not null check (reason in ('rude', 'calls', 'coaching', 'organizing', 'unsafe', 'other')),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (session_id, reporter_id, subject_id),
  check (reporter_id <> subject_id)
);
create index if not exists conduct_flags_subject on conduct_flags (subject_id, created_at desc);

create table if not exists conduct_notes (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references profiles(id) on delete cascade,
  author_id uuid references profiles(id) on delete set null,
  kind text not null check (kind in ('note', 'warning', 'cleared')),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists conduct_notes_subject on conduct_notes (subject_id, created_at desc);

alter table conduct_flags enable row level security;
alter table conduct_notes enable row level security;
revoke all on conduct_flags, conduct_notes from anon, authenticated;

-- How many different players it takes before admins are alerted, and over how many days.
create or replace function _conduct_threshold() returns int language sql immutable as $$ select 3 $$;
create or replace function _conduct_days() returns int language sql immutable as $$ select 60 $$;

-- A player can flag people from a session they played in, from its start until 3 days after.
create or replace function _flag_window_ok(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sessions s
    where s.id = p_session and not coalesce(s.is_cancelled, false)
      and (s.session_date + s.time_start::time) <= (now() at time zone 'Asia/Manila')
      and s.session_date >= (now() at time zone 'Asia/Manila')::date - 3)
$$;

create or replace function _played_in(p_user uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from registrations r
    where r.session_uuid = p_session and r.user_id = p_user and r.status = 'paid')
$$;

-- The people I can flag from a session, with what I already sent about each.
create or replace function flag_targets(p_session uuid) returns table (id uuid, full_name text, my_reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not _played_in(auth.uid(), p_session) then raise exception 'You can only flag people from a session you played in'; end if;
  if not _flag_window_ok(p_session) then raise exception 'Flags are open from the start of the session until 3 days after'; end if;
  return query
    select distinct on (p.id) p.id, p.full_name, f.reason
    from registrations r join profiles p on p.id = r.user_id
    left join conduct_flags f on f.session_id = p_session and f.reporter_id = auth.uid() and f.subject_id = p.id
    where r.session_uuid = p_session and r.status = 'paid' and r.user_id <> auth.uid()
    order by p.id;
end $$;

create or replace function flag_player(p_session uuid, p_subject uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_subject = auth.uid() then raise exception 'You can''t flag yourself'; end if;
  if p_reason not in ('rude', 'calls', 'coaching', 'organizing', 'unsafe', 'other') then raise exception 'Pick a reason'; end if;
  if p_reason = 'other' and coalesce(btrim(p_note), '') = '' then raise exception 'Say briefly what happened'; end if;
  if char_length(coalesce(p_note, '')) > 200 then raise exception 'Keep the note under 200 characters'; end if;
  if not _played_in(auth.uid(), p_session) then raise exception 'You can only flag people from a session you played in'; end if;
  if not _played_in(p_subject, p_session) then raise exception 'That player wasn''t in this session'; end if;
  if not _flag_window_ok(p_session) then raise exception 'Flags are open from the start of the session until 3 days after'; end if;
  insert into conduct_flags (session_id, reporter_id, subject_id, reason, note)
  values (p_session, auth.uid(), p_subject, p_reason, nullif(btrim(p_note), ''))
  on conflict (session_id, reporter_id, subject_id) do update set reason = excluded.reason, note = excluded.note, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function unflag_player(p_session uuid, p_subject uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from conduct_flags where session_id = p_session and reporter_id = auth.uid() and subject_id = p_subject;
  return jsonb_build_object('ok', true);
end $$;

-- Players flagged by enough different people recently, and not looked at since the last flag.
create or replace function admin_conduct_alerts() returns table (
  id uuid, full_name text, tier text, people int, flags int, last_flag timestamptz, reasons text[], last_action text, last_action_at timestamptz)
language sql stable security definer set search_path = public as $$
  with recent as (
    select f.* from conduct_flags f where f.created_at > now() - make_interval(days => _conduct_days())
  ), agg as (
    select subject_id, count(distinct reporter_id)::int people, count(*)::int flags, max(created_at) last_flag,
      array_agg(distinct reason) reasons
    from recent group by subject_id
  )
  select p.id, p.full_name, coalesce(p.access_tier, 'community'), a.people, a.flags, a.last_flag, a.reasons, n.kind, n.created_at
  from agg a join profiles p on p.id = a.subject_id
  left join lateral (select kind, created_at from conduct_notes n where n.subject_id = a.subject_id order by created_at desc limit 1) n on true
  where is_club_admin() and a.people >= _conduct_threshold() and (n.created_at is null or n.created_at < a.last_flag)
  order by a.people desc, a.last_flag desc;
$$;

-- Everything on one player: flags (with who sent them, for admins only) and admin notes, newest first.
create or replace function admin_conduct_log(p_member uuid) returns table (
  at timestamptz, kind text, reason text, body text, session_label text, session_date date, by_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_club_admin() then raise exception 'Admins only'; end if;
  return query
    select * from (
      select f.created_at, 'flag'::text, f.reason, f.note, s.label, s.session_date, rp.full_name
      from conduct_flags f join sessions s on s.id = f.session_id left join profiles rp on rp.id = f.reporter_id
      where f.subject_id = p_member
      union all
      select n.created_at, n.kind, null::text, n.body, null::text, null::date, ap.full_name
      from conduct_notes n left join profiles ap on ap.id = n.author_id
      where n.subject_id = p_member
    ) x order by 1 desc;
end $$;

create or replace function admin_conduct_note(p_member uuid, p_kind text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_club_admin() then raise exception 'Admins only'; end if;
  if p_kind not in ('note', 'warning', 'cleared') then raise exception 'Unknown entry'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'Write what happened'; end if;
  insert into conduct_notes (subject_id, author_id, kind, body) values (p_member, auth.uid(), p_kind, btrim(p_body));
  return jsonb_build_object('ok', true);
end $$;

-- Counts for the members list: different players who flagged each person in the window.
create or replace function admin_conduct_counts() returns table (id uuid, people int)
language sql stable security definer set search_path = public as $$
  select subject_id, count(distinct reporter_id)::int from conduct_flags
  where is_club_admin() and created_at > now() - make_interval(days => _conduct_days())
  group by subject_id;
$$;

revoke all on function _flag_window_ok(uuid), _played_in(uuid, uuid), _conduct_threshold(), _conduct_days() from public, anon, authenticated;
revoke all on function flag_targets(uuid), flag_player(uuid, uuid, text, text), unflag_player(uuid, uuid),
  admin_conduct_alerts(), admin_conduct_log(uuid), admin_conduct_note(uuid, text, text), admin_conduct_counts() from public, anon;
grant execute on function flag_targets(uuid), flag_player(uuid, uuid, text, text), unflag_player(uuid, uuid),
  admin_conduct_alerts(), admin_conduct_log(uuid), admin_conduct_note(uuid, text, text), admin_conduct_counts() to authenticated;
