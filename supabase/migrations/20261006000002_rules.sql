-- Courtside business rules. Every write a client can make goes through one of these functions.

-- ════════════════════════════════════════════════════════════ clubs & members

create or replace function public.create_club(p_name text, p_slug text, p_short_code text,
  p_city text default null, p_owner uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; owner_id uuid := coalesce(p_owner, auth.uid());
begin
  if not is_platform_admin() then raise exception 'Only platform admins can create clubs'; end if;
  insert into clubs (name, slug, short_code, city)
  values (trim(p_name), lower(trim(p_slug)), upper(trim(p_short_code)), p_city)
  returning id into cid;
  insert into club_role_rules (club_id, role, window_hours, max_guests) values
    (cid, 'owner', 2160, 10), (cid, 'admin', 2160, 10), (cid, 'host', 2160, 10),
    (cid, 'varsity', 168, 2), (cid, 'member', 72, 1), (cid, 'flagged', 1, 0);
  insert into club_hours (club_id, weekday, opens, closes)
    select cid, d, '06:00', '00:00' from generate_series(0, 6) d;
  insert into memberships (club_id, user_id, role) values (cid, owner_id, 'owner');
  perform audit(cid, 'club.create', 'club', cid, jsonb_build_object('owner', owner_id));
  return cid;
end $$;

create or replace function public.update_club(p_club uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text;
  allowed text[] := array['name','tagline','venue_name','address','city','gcash_number','gcash_name',
    'join_policy','refund_cutoff_hours','court_booking_days_ahead','court_min_minutes','court_max_minutes',
    'court_slot_minutes','is_published'];
  platform_only text[] := array['techpay_enabled','techpay_merchant_code','platform_fee_pct','short_code','slug'];
begin
  if not is_club_admin(p_club) then raise exception 'Only club admins can change club settings'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k = any(platform_only) and not is_platform_admin() then
      raise exception 'Only the platform team can change %', k;
    end if;
    if not (k = any(allowed) or k = any(platform_only)) then raise exception 'Unknown setting %', k; end if;
  end loop;
  if p_patch ? 'gcash_number' and coalesce(p_patch->>'gcash_number','') <> ''
     and regexp_replace(p_patch->>'gcash_number', '\D', '', 'g') !~ '^(09\d{9}|639\d{9})$' then
    raise exception 'GCash number should look like 09XXXXXXXXX';
  end if;
  update clubs c set
    name = coalesce(p_patch->>'name', c.name),
    tagline = case when p_patch ? 'tagline' then p_patch->>'tagline' else c.tagline end,
    venue_name = case when p_patch ? 'venue_name' then p_patch->>'venue_name' else c.venue_name end,
    address = case when p_patch ? 'address' then p_patch->>'address' else c.address end,
    city = case when p_patch ? 'city' then p_patch->>'city' else c.city end,
    gcash_number = case when p_patch ? 'gcash_number' then nullif(regexp_replace(p_patch->>'gcash_number', '\D', '', 'g'), '') else c.gcash_number end,
    gcash_name = case when p_patch ? 'gcash_name' then nullif(p_patch->>'gcash_name', '') else c.gcash_name end,
    join_policy = coalesce(p_patch->>'join_policy', c.join_policy),
    refund_cutoff_hours = coalesce((p_patch->>'refund_cutoff_hours')::int, c.refund_cutoff_hours),
    court_booking_days_ahead = coalesce((p_patch->>'court_booking_days_ahead')::int, c.court_booking_days_ahead),
    court_min_minutes = coalesce((p_patch->>'court_min_minutes')::int, c.court_min_minutes),
    court_max_minutes = coalesce((p_patch->>'court_max_minutes')::int, c.court_max_minutes),
    court_slot_minutes = coalesce((p_patch->>'court_slot_minutes')::int, c.court_slot_minutes),
    is_published = coalesce((p_patch->>'is_published')::boolean, c.is_published),
    techpay_enabled = coalesce((p_patch->>'techpay_enabled')::boolean, c.techpay_enabled),
    techpay_merchant_code = case when p_patch ? 'techpay_merchant_code' then nullif(p_patch->>'techpay_merchant_code','') else c.techpay_merchant_code end,
    platform_fee_pct = coalesce((p_patch->>'platform_fee_pct')::numeric, c.platform_fee_pct),
    short_code = coalesce(upper(p_patch->>'short_code'), c.short_code),
    slug = coalesce(lower(p_patch->>'slug'), c.slug)
  where c.id = p_club;
  perform audit(p_club, 'club.update', 'club', p_club, p_patch);
end $$;

create or replace function public.join_club(p_club uuid)
returns public.club_role language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r club_role; pol text;
begin
  if me is null then raise exception 'Please sign in first'; end if;
  select role into r from memberships where club_id = p_club and user_id = me;
  if r is not null then return r; end if;
  select join_policy into pol from clubs where id = p_club and is_published;
  if pol is null then raise exception 'Club not found'; end if;
  insert into memberships (club_id, user_id, role)
  values (p_club, me, case when pol = 'open' then 'member'::club_role else 'pending'::club_role end)
  returning role into r;
  return r;
end $$;

create or replace function public.publish_house_rules(p_club uuid, p_body text)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not is_club_admin(p_club) then raise exception 'Only club admins can publish house rules'; end if;
  if length(trim(coalesce(p_body,''))) < 10 then raise exception 'House rules are too short'; end if;
  select coalesce(max(version), 0) + 1 into v from house_rules where club_id = p_club;
  insert into house_rules (club_id, version, body) values (p_club, v, trim(p_body));
  perform audit(p_club, 'rules.publish', 'club', p_club, jsonb_build_object('version', v));
  return v;
end $$;

create or replace function public.accept_house_rules(p_club uuid, p_version int)
returns void language plpgsql security definer set search_path = public as $$
declare latest int;
begin
  select max(version) into latest from house_rules where club_id = p_club;
  if latest is null or p_version <> latest then raise exception 'These house rules have been updated. Please read the latest version.'; end if;
  perform join_club(p_club);
  update memberships set rules_version_accepted = p_version, rules_accepted_at = now()
  where club_id = p_club and user_id = auth.uid();
end $$;

create or replace function public.set_member_role(p_club uuid, p_user uuid, p_role public.club_role, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare old club_role;
begin
  if not is_club_admin(p_club) then raise exception 'Only club admins can change roles'; end if;
  select role into old from memberships where club_id = p_club and user_id = p_user for update;
  if old is null then raise exception 'That player is not a member of this club'; end if;
  if (old = 'owner' or p_role = 'owner') and not (my_role(p_club) = 'owner' or is_platform_admin()) then
    raise exception 'Only the club owner can change ownership';
  end if;
  if old = 'owner' and p_role <> 'owner'
     and (select count(*) from memberships where club_id = p_club and role = 'owner') <= 1 then
    raise exception 'A club needs at least one owner';
  end if;
  update memberships set role = p_role, note = coalesce(p_note, note) where club_id = p_club and user_id = p_user;
  perform audit(p_club, 'member.role', 'profile', p_user,
    jsonb_build_object('from', old, 'to', p_role, 'note', p_note));
end $$;

create or replace function public.set_role_rule(p_club uuid, p_role public.club_role, p_window_hours int, p_max_guests int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_club_admin(p_club) then raise exception 'Only club admins can change booking windows'; end if;
  insert into club_role_rules (club_id, role, window_hours, max_guests)
  values (p_club, p_role, p_window_hours, p_max_guests)
  on conflict (club_id, role) do update set window_hours = excluded.window_hours, max_guests = excluded.max_guests;
  perform audit(p_club, 'rules.window', 'club', p_club,
    jsonb_build_object('role', p_role, 'window_hours', p_window_hours, 'max_guests', p_max_guests));
end $$;

-- Common gate for any booking: signed in, member in good standing, latest rules accepted.
create or replace function public.require_bookable_member(p_club uuid) returns public.club_role
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m record; latest int;
begin
  if me is null then raise exception 'Please sign in first'; end if;
  select * into m from memberships where club_id = p_club and user_id = me;
  if m is null then raise exception 'Join this club before booking'; end if;
  if m.role = 'pending' then raise exception 'Your membership is waiting for club approval'; end if;
  if m.role = 'banned' then raise exception 'You can''t book at this club. Please contact the club.'; end if;
  select max(version) into latest from house_rules where club_id = p_club;
  if latest is not null and coalesce(m.rules_version_accepted, 0) < latest then
    raise exception 'Please read and accept the house rules first';
  end if;
  if coalesce((select length(trim(coalesce(phone,''))) from profiles where id = me), 0) < 10 then
    raise exception 'Add your mobile number to your profile first (clubs use it for refunds)';
  end if;
  return m.role;
end $$;

-- ════════════════════════════════════════════════════════════ courts

create or replace function public.upsert_court(p_club uuid, p_id uuid, p_name text, p_hourly_rate numeric,
  p_surface text default null, p_rentable boolean default true, p_active boolean default true, p_sort int default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not is_club_admin(p_club) then raise exception 'Only club admins can manage courts'; end if;
  if p_id is null then
    insert into courts (club_id, name, hourly_rate, surface, rentable, active, sort)
    values (p_club, trim(p_name), p_hourly_rate, p_surface, p_rentable, p_active, p_sort) returning id into cid;
  else
    update courts set name = trim(p_name), hourly_rate = p_hourly_rate, surface = p_surface,
      rentable = p_rentable, active = p_active, sort = p_sort
    where id = p_id and club_id = p_club returning id into cid;
    if cid is null then raise exception 'Court not found'; end if;
  end if;
  perform audit(p_club, 'court.save', 'court', cid, jsonb_build_object('name', p_name, 'rate', p_hourly_rate));
  return cid;
end $$;

-- p_hours: [{"weekday":0,"opens":"06:00","closes":"00:00"}, ...] — replaces all hours.
create or replace function public.set_club_hours(p_club uuid, p_hours jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_club_admin(p_club) then raise exception 'Only club admins can change opening hours'; end if;
  delete from club_hours where club_id = p_club;
  insert into club_hours (club_id, weekday, opens, closes)
  select p_club, (h->>'weekday')::int, (h->>'opens')::time, (h->>'closes')::time
  from jsonb_array_elements(p_hours) h;
  perform audit(p_club, 'club.hours', 'club', p_club, p_hours);
end $$;

create or replace function public.save_rate_rule(p_club uuid, p_id uuid, p_label text, p_court uuid,
  p_weekdays int[], p_starts time, p_ends time, p_rate numeric, p_priority int default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not is_club_admin(p_club) then raise exception 'Only club admins can change rates'; end if;
  if p_id is null then
    insert into rate_rules (club_id, court_id, label, weekdays, starts, ends, hourly_rate, priority)
    values (p_club, p_court, p_label, p_weekdays, p_starts, p_ends, p_rate, p_priority) returning id into rid;
  else
    update rate_rules set court_id = p_court, label = p_label, weekdays = p_weekdays, starts = p_starts,
      ends = p_ends, hourly_rate = p_rate, priority = p_priority
    where id = p_id and club_id = p_club returning id into rid;
  end if;
  perform audit(p_club, 'rate.save', 'rate_rule', rid, jsonb_build_object('label', p_label, 'rate', p_rate));
  return rid;
end $$;

create or replace function public.delete_rate_rule(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from rate_rules where id = p_id;
  if c is null or not is_club_admin(c) then raise exception 'Not allowed'; end if;
  delete from rate_rules where id = p_id;
  perform audit(c, 'rate.delete', 'rate_rule', p_id);
end $$;

-- Is local time t (on local date d, weekday wd) inside the club's opening hours?
create or replace function public.within_hours(p_club uuid, p_start timestamptz, p_end timestamptz)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare tz text; ls timestamp; le timestamp; h record; day_open timestamp; day_close timestamp;
begin
  select timezone into tz from clubs where id = p_club;
  ls := p_start at time zone tz; le := p_end at time zone tz;
  select * into h from club_hours where club_id = p_club and weekday = extract(dow from ls)::int;
  if h is null then return false; end if;
  day_open := date_trunc('day', ls) + h.opens;
  day_close := date_trunc('day', ls) + h.closes;
  if h.closes <= h.opens then day_close := day_close + interval '1 day'; end if;  -- closes at/after midnight
  return ls >= day_open and le <= day_close;
end $$;

-- Price of renting a court for [p_start, p_end), summing each slot at its applicable rate.
create or replace function public.court_price(p_court uuid, p_start timestamptz, p_end timestamptz)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare c record; tz text; step int; t timestamptz; lt timestamp; rate numeric; total numeric := 0;
begin
  select ct.*, cl.timezone, cl.court_slot_minutes into c
  from courts ct join clubs cl on cl.id = ct.club_id where ct.id = p_court;
  tz := c.timezone; step := c.court_slot_minutes;
  t := p_start;
  while t < p_end loop
    lt := t at time zone tz;
    select r.hourly_rate into rate from rate_rules r
    where r.club_id = c.club_id and (r.court_id is null or r.court_id = p_court)
      and extract(dow from lt)::int = any(r.weekdays)
      and lt::time >= r.starts and (lt::time < r.ends or r.ends = '00:00')
    order by r.priority desc, (r.court_id is not null) desc limit 1;
    total := total + coalesce(rate, c.hourly_rate) * step / 60.0;
    t := t + make_interval(mins => step);
  end loop;
  return round(total, 2);
end $$;

-- What's taken on a club's courts for one local day (no personal details).
create or replace function public.court_availability(p_club uuid, p_day date)
returns table (court_id uuid, starts_at timestamptz, ends_at timestamptz, kind text)
language sql stable security definer set search_path = public as $$
  select r.court_id, lower(r.period), upper(r.period), r.source
  from court_reservations r join clubs c on c.id = r.club_id
  where r.club_id = p_club and r.active
    and r.period && tstzrange((p_day::timestamp at time zone c.timezone),
                              ((p_day + 1)::timestamp at time zone c.timezone))
$$;

create or replace function public.block_court(p_court uuid, p_start timestamptz, p_end timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid; rid uuid;
begin
  select club_id into c from courts where id = p_court;
  if c is null or not is_club_staff(c) then raise exception 'Not allowed'; end if;
  begin
    insert into court_reservations (club_id, court_id, period, source)
    values (c, p_court, tstzrange(p_start, p_end), 'block') returning id into rid;
  exception when exclusion_violation then
    raise exception 'That court already has a booking in this period';
  end;
  perform audit(c, 'court.block', 'court', p_court, jsonb_build_object('from', p_start, 'to', p_end, 'reason', p_reason));
  return rid;
end $$;

create or replace function public.unblock_court(p_reservation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from court_reservations where id = p_reservation and source = 'block';
  if r is null or not is_club_staff(r.club_id) then raise exception 'Not allowed'; end if;
  update court_reservations set active = false where id = p_reservation;
  perform audit(r.club_id, 'court.unblock', 'court', r.court_id, jsonb_build_object('reservation', p_reservation));
end $$;

-- ════════════════════════════════════════════════════════════ sessions

create or replace function public.create_session(p_club uuid, p_title text, p_starts timestamptz, p_ends timestamptz,
  p_fee numeric, p_capacity int, p_court_ids uuid[] default '{}', p_description text default null,
  p_level text default null, p_waitlist boolean default true, p_refund_cutoff_hours int default null,
  p_host uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; ct uuid;
begin
  if not is_club_admin(p_club) then raise exception 'Only club admins can create sessions'; end if;
  if p_starts <= now() then raise exception 'Session must start in the future'; end if;
  if exists (select 1 from unnest(p_court_ids) x where x not in (select id from courts where club_id = p_club)) then
    raise exception 'Unknown court';
  end if;
  insert into sessions (club_id, title, description, starts_at, ends_at, fee, capacity, court_ids, level,
    waitlist_enabled, refund_cutoff_hours, host_id, created_by)
  values (p_club, trim(p_title), p_description, p_starts, p_ends, p_fee, p_capacity, coalesce(p_court_ids,'{}'),
    p_level, p_waitlist, p_refund_cutoff_hours, p_host, auth.uid())
  returning id into sid;
  foreach ct in array coalesce(p_court_ids, '{}') loop
    begin
      insert into court_reservations (club_id, court_id, period, source, source_id)
      values (p_club, ct, tstzrange(p_starts, p_ends), 'session', sid);
    exception when exclusion_violation then
      raise exception 'Court % is already booked for part of that time', (select name from courts where id = ct);
    end;
  end loop;
  perform audit(p_club, 'session.create', 'session', sid,
    jsonb_build_object('title', p_title, 'starts', p_starts, 'fee', p_fee, 'capacity', p_capacity));
  return sid;
end $$;

-- Allowed: title, description, level, host_id, capacity, waitlist_enabled. Fee and time are fixed once created.
create or replace function public.update_session(p_session uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare s record; taken int;
begin
  select * into s from sessions where id = p_session for update;
  if s is null or not is_club_admin(s.club_id) then raise exception 'Not allowed'; end if;
  if s.status <> 'scheduled' then raise exception 'This session is %', s.status; end if;
  if p_patch ? 'capacity' then
    taken := seats_taken(p_session);
    if (p_patch->>'capacity')::int < taken then
      raise exception 'Capacity can''t go below the % seats already taken', taken;
    end if;
  end if;
  update sessions set
    title = coalesce(p_patch->>'title', title),
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    level = case when p_patch ? 'level' then p_patch->>'level' else level end,
    host_id = case when p_patch ? 'host_id' then nullif(p_patch->>'host_id','')::uuid else host_id end,
    capacity = coalesce((p_patch->>'capacity')::int, capacity),
    waitlist_enabled = coalesce((p_patch->>'waitlist_enabled')::boolean, waitlist_enabled)
  where id = p_session;
  perform promote_waitlist(p_session);
  perform audit(s.club_id, 'session.update', 'session', p_session, p_patch);
end $$;

-- Move waitlisted (paid) bookings into free seats, oldest first. Returns seats promoted.
create or replace function public.promote_waitlist(p_session uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s record; free int; b record; promoted int := 0;
begin
  select * into s from sessions where id = p_session for update;
  if s.status <> 'scheduled' or s.starts_at <= now() then return 0; end if;
  free := s.capacity - seats_taken(p_session);
  for b in select * from session_bookings where session_id = p_session and status = 'waitlisted'
           order by created_at for update loop
    exit when free <= 0;
    if b.seats <= free then
      update session_bookings set status = 'confirmed' where id = b.id;
      free := free - b.seats; promoted := promoted + b.seats;
      perform audit(s.club_id, 'booking.promoted', 'session_booking', b.id, '{}'::jsonb);
    end if;
  end loop;
  return promoted;
end $$;

create or replace function public.book_session(p_session uuid, p_guest_names text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); s record; r club_role; rule record; guests text[]; seats int;
  amt numeric; st text; bid uuid; hold timestamptz;
begin
  select * into s from sessions where id = p_session for update;   -- serialises bookings per session
  if s is null then raise exception 'Session not found'; end if;
  if s.status <> 'scheduled' then raise exception 'This session is %', s.status; end if;
  if s.starts_at <= now() then raise exception 'This session has already started'; end if;
  r := require_bookable_member(s.club_id);

  select * into rule from club_role_rules where club_id = s.club_id and role = r;
  if rule is null then select * into rule from club_role_rules where club_id = s.club_id and role = 'member'; end if;
  if now() < s.starts_at - make_interval(hours => coalesce(rule.window_hours, 72)) then
    raise exception 'Booking opens % for you',
      to_char((s.starts_at - make_interval(hours => coalesce(rule.window_hours, 72))) at time zone 'Asia/Manila',
              'Dy DD Mon, HH12:MI AM');
  end if;

  select coalesce(array_agg(trim(g)), '{}') into guests from unnest(coalesce(p_guest_names, '{}')) g where trim(g) <> '';
  if coalesce(array_length(guests, 1), 0) > coalesce(rule.max_guests, 1) then
    if coalesce(rule.max_guests, 1) = 0 then raise exception 'Guests aren''t available on your membership';
    else raise exception 'You can bring up to % guest(s)', rule.max_guests; end if;
  end if;
  seats := 1 + coalesce(array_length(guests, 1), 0);

  if exists (select 1 from session_bookings where session_id = p_session and user_id = me
             and status in ('pending_payment','confirmed','waitlist_pending_payment','waitlisted')) then
    raise exception 'You already have a booking for this session';
  end if;

  amt := s.fee * seats;
  hold := now() + make_interval(mins => hold_minutes());
  if s.capacity - seats_taken(p_session) >= seats then
    st := case when amt = 0 then 'confirmed' else 'pending_payment' end;
  elsif s.waitlist_enabled then
    st := case when amt = 0 then 'waitlisted' else 'waitlist_pending_payment' end;
  else
    raise exception 'This session is full';
  end if;

  insert into session_bookings (club_id, session_id, user_id, guest_names, amount, status, hold_expires_at)
  values (s.club_id, p_session, me, guests, amt, st, case when amt = 0 then null else hold end)
  returning id into bid;
  return jsonb_build_object('booking_id', bid, 'status', st, 'amount', amt, 'seats', seats,
    'hold_expires_at', case when amt = 0 then null else hold end);
end $$;

-- Shared by player and staff cancellations. p_refund: 'policy' | 'full' | 'none'.
create or replace function public.do_cancel_session_booking(p_booking uuid, p_refund text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b record; s record; promoted int := 0; refund numeric := 0; was text;
begin
  select * into b from session_bookings where id = p_booking;
  if b is null then raise exception 'Booking not found'; end if;
  select * into s from sessions where id = b.session_id for update;
  select * into b from session_bookings where id = p_booking for update;
  was := b.status;
  if was in ('cancelled','expired') then raise exception 'This booking is already %', was; end if;

  update session_bookings set status = 'cancelled', cancelled_at = now(), hold_expires_at = null where id = p_booking;

  if was = 'confirmed' then
    promoted := promote_waitlist(b.session_id);
    if p_refund = 'full' or (p_refund = 'policy' and now() < session_refund_cutoff(b.session_id)) then
      refund := b.paid_amount;
    elsif p_refund = 'policy' and promoted > 0 then
      -- late cancel, but someone from the waitlist took the seat(s): refund what was refilled
      refund := round(b.paid_amount * least(promoted, b.seats)::numeric / b.seats, 2);
    end if;
  elsif was = 'waitlisted' then
    refund := case when p_refund = 'none' then 0 else b.paid_amount end;  -- waitlist deposits always return
  elsif was = 'pending_payment' then
    promoted := promote_waitlist(b.session_id);
    refund := b.paid_amount;  -- normally 0
  else
    refund := b.paid_amount;
  end if;

  if refund > 0 then
    perform owe_refund(b.club_id, b.user_id, null, 'session_booking', b.id, refund,
      coalesce(p_reason, 'Cancelled: ' || s.title || ' ' || to_char(s.starts_at at time zone 'Asia/Manila', 'DD Mon')));
  end if;
  return jsonb_build_object('cancelled', true, 'was', was, 'refund', refund, 'promoted', promoted);
end $$;

create or replace function public.cancel_session_booking(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from session_bookings where id = p_booking and user_id = auth.uid()) then
    raise exception 'Booking not found';
  end if;
  return do_cancel_session_booking(p_booking, 'policy', null);
end $$;

create or replace function public.staff_cancel_session_booking(p_booking uuid, p_refund boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; res jsonb;
begin
  select club_id into c from session_bookings where id = p_booking;
  if c is null or not is_club_admin(c) then raise exception 'Not allowed'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Please give a reason'; end if;
  res := do_cancel_session_booking(p_booking, case when p_refund then 'full' else 'none' end, 'Cancelled by club: ' || p_reason);
  perform audit(c, 'booking.staff_cancel', 'session_booking', p_booking, res || jsonb_build_object('reason', p_reason));
  return res;
end $$;

create or replace function public.cancel_session(p_session uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; b record; n int := 0; total numeric := 0;
begin
  select * into s from sessions where id = p_session for update;
  if s is null or not is_club_admin(s.club_id) then raise exception 'Not allowed'; end if;
  if s.status <> 'scheduled' then raise exception 'This session is already %', s.status; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Please give a reason'; end if;
  update sessions set status = 'cancelled', cancel_reason = p_reason where id = p_session;
  update court_reservations set active = false where source = 'session' and source_id = p_session;
  for b in select * from session_bookings where session_id = p_session
           and status in ('pending_payment','confirmed','waitlist_pending_payment','waitlisted') for update loop
    update session_bookings set status = 'cancelled', cancelled_at = now(), hold_expires_at = null where id = b.id;
    if b.paid_amount > 0 then
      perform owe_refund(s.club_id, b.user_id, null, 'session_booking', b.id, b.paid_amount,
        'Session cancelled by club: ' || p_reason);
      total := total + b.paid_amount;
    end if;
    n := n + 1;
  end loop;
  perform audit(s.club_id, 'session.cancel', 'session', p_session,
    jsonb_build_object('reason', p_reason, 'bookings', n, 'refunds_total', total));
  return jsonb_build_object('bookings_cancelled', n, 'refunds_owed', total);
end $$;

create or replace function public.check_in(p_booking uuid, p_in boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from session_bookings where id = p_booking;
  if c is null or not is_club_staff(c) then raise exception 'Not allowed'; end if;
  update session_bookings set checked_in_at = case when p_in then now() else null end where id = p_booking;
end $$;

-- Staff adds a player (walk-in, comp or cash). Goes over capacity only if p_force.
create or replace function public.staff_add_to_session(p_session uuid, p_user uuid, p_guest_names text[],
  p_cash_paid numeric, p_reason text, p_force boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare s record; bid uuid; seats int; amt numeric; pid uuid;
begin
  select * into s from sessions where id = p_session for update;
  if s is null or not is_club_staff(s.club_id) then raise exception 'Not allowed'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Please give a reason'; end if;
  if not exists (select 1 from memberships where club_id = s.club_id and user_id = p_user) then
    insert into memberships (club_id, user_id, role) values (s.club_id, p_user, 'member');
  end if;
  seats := 1 + coalesce(array_length(p_guest_names, 1), 0);
  if not p_force and s.capacity - seats_taken(p_session) < seats then
    raise exception 'Session is full (use override to add anyway)';
  end if;
  amt := s.fee * seats;
  insert into session_bookings (club_id, session_id, user_id, guest_names, amount, status, source, paid_amount)
  values (s.club_id, p_session, p_user, coalesce(p_guest_names,'{}'), amt, 'confirmed', 'staff', coalesce(p_cash_paid,0))
  returning id into bid;
  if coalesce(p_cash_paid, 0) > 0 then
    insert into payments (club_id, user_id, purpose, purpose_id, amount, method, status, reviewed_by, reviewed_at, review_note, paid_at)
    values (s.club_id, p_user, 'session_booking', bid, p_cash_paid, 'cash', 'approved', auth.uid(), now(), p_reason, now())
    returning id into pid;
  end if;
  perform audit(s.club_id, 'booking.staff_add', 'session_booking', bid,
    jsonb_build_object('user', p_user, 'cash', p_cash_paid, 'reason', p_reason, 'forced', p_force));
  return bid;
end $$;

-- ════════════════════════════════════════════════════════════ court rentals

create or replace function public.book_court(p_court uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c record; cl record; mins int; amt numeric; bid uuid; hold timestamptz; st text;
begin
  select * into c from courts where id = p_court;
  if c is null or not c.active or not c.rentable then raise exception 'This court can''t be rented'; end if;
  select * into cl from clubs where id = c.club_id;
  perform require_bookable_member(c.club_id);
  if p_start <= now() then raise exception 'Pick a time in the future'; end if;
  if p_start > now() + make_interval(days => cl.court_booking_days_ahead) then
    raise exception 'Courts can be booked up to % days ahead', cl.court_booking_days_ahead;
  end if;
  mins := extract(epoch from (p_end - p_start))::int / 60;
  if mins < cl.court_min_minutes then raise exception 'Minimum booking is % minutes', cl.court_min_minutes; end if;
  if mins > cl.court_max_minutes then raise exception 'Maximum booking is % minutes', cl.court_max_minutes; end if;
  if mins % cl.court_slot_minutes <> 0
     or extract(epoch from (p_start at time zone cl.timezone)::time)::int % (cl.court_slot_minutes * 60) <> 0 then
    raise exception 'Bookings start on the % minute mark', cl.court_slot_minutes;
  end if;
  if not within_hours(c.club_id, p_start, p_end) then raise exception 'That''s outside opening hours'; end if;
  if (select count(*) from court_bookings where user_id = me and status = 'pending_payment' and hold_expires_at > now()) >= 3 then
    raise exception 'Finish paying for your other held courts first';
  end if;

  amt := court_price(p_court, p_start, p_end);
  hold := now() + make_interval(mins => hold_minutes());
  st := case when amt = 0 then 'confirmed' else 'pending_payment' end;
  insert into court_bookings (club_id, court_id, user_id, starts_at, ends_at, amount, status, hold_expires_at)
  values (c.club_id, p_court, me, p_start, p_end, amt, st, case when amt = 0 then null else hold end)
  returning id into bid;
  begin
    insert into court_reservations (club_id, court_id, period, source, source_id)
    values (c.club_id, p_court, tstzrange(p_start, p_end), 'rental', bid);
  exception when exclusion_violation then
    raise exception 'Someone just took that slot. Please pick another time.';
  end;
  return jsonb_build_object('booking_id', bid, 'status', st, 'amount', amt,
    'hold_expires_at', case when amt = 0 then null else hold end);
end $$;

create or replace function public.do_cancel_court_booking(p_booking uuid, p_refund text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b record; cutoff timestamptz; refund numeric := 0; was text;
begin
  select * into b from court_bookings where id = p_booking for update;
  if b is null then raise exception 'Booking not found'; end if;
  was := b.status;
  if was in ('cancelled','expired') then raise exception 'This booking is already %', was; end if;
  update court_bookings set status = 'cancelled', cancelled_at = now(), hold_expires_at = null where id = p_booking;
  update court_reservations set active = false where source = 'rental' and source_id = p_booking;
  select b.starts_at - make_interval(hours => refund_cutoff_hours) into cutoff from clubs where id = b.club_id;
  if p_refund = 'full' or (p_refund = 'policy' and now() < cutoff) or was = 'pending_payment' then
    refund := b.paid_amount;
  end if;
  if refund > 0 then
    perform owe_refund(b.club_id, b.user_id, null, 'court_booking', b.id, refund, coalesce(p_reason, 'Court booking cancelled'));
  end if;
  return jsonb_build_object('cancelled', true, 'was', was, 'refund', refund);
end $$;

create or replace function public.cancel_court_booking(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from court_bookings where id = p_booking and user_id = auth.uid()) then
    raise exception 'Booking not found';
  end if;
  return do_cancel_court_booking(p_booking, 'policy', null);
end $$;

create or replace function public.staff_cancel_court_booking(p_booking uuid, p_refund boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; res jsonb;
begin
  select club_id into c from court_bookings where id = p_booking;
  if c is null or not is_club_admin(c) then raise exception 'Not allowed'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Please give a reason'; end if;
  res := do_cancel_court_booking(p_booking, case when p_refund then 'full' else 'none' end, 'Cancelled by club: ' || p_reason);
  perform audit(c, 'court_booking.staff_cancel', 'court_booking', p_booking, res || jsonb_build_object('reason', p_reason));
  return res;
end $$;

-- ════════════════════════════════════════════════════════════ payments

-- What is still owed on a booking, and who owns it. Raises if it can't be paid now.
create or replace function public.payable(p_purpose text, p_booking uuid)
returns table (club_id uuid, user_id uuid, due numeric)
language plpgsql stable security definer set search_path = public as $$
declare b record;
begin
  if p_purpose = 'session_booking' then
    select sb.club_id, sb.user_id, sb.amount - sb.paid_amount as due, sb.status, sb.hold_expires_at
      into b from session_bookings sb where sb.id = p_booking;
    if b is null then raise exception 'Booking not found'; end if;
    if b.status not in ('pending_payment','waitlist_pending_payment') then
      raise exception 'This booking is % and doesn''t need payment', replace(b.status, '_', ' ');
    end if;
  elsif p_purpose = 'court_booking' then
    select cb.club_id, cb.user_id, cb.amount - cb.paid_amount as due, cb.status, cb.hold_expires_at
      into b from court_bookings cb where cb.id = p_booking;
    if b is null then raise exception 'Booking not found'; end if;
    if b.status <> 'pending_payment' then
      raise exception 'This booking is % and doesn''t need payment', replace(b.status, '_', ' ');
    end if;
  else
    raise exception 'Unknown payment purpose';
  end if;
  if b.hold_expires_at is not null and b.hold_expires_at < now() then
    raise exception 'Your hold has expired. Please book again.';
  end if;
  if b.due <= 0 then raise exception 'Nothing left to pay'; end if;
  club_id := b.club_id; user_id := b.user_id; due := b.due;
  return next;
end $$;

create or replace function public.extend_hold(p_purpose text, p_booking uuid, p_until timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_purpose = 'session_booking' then
    update session_bookings set hold_expires_at = greatest(coalesce(hold_expires_at, p_until), p_until) where id = p_booking;
  else
    update court_bookings set hold_expires_at = greatest(coalesce(hold_expires_at, p_until), p_until) where id = p_booking;
  end if;
end $$;

-- Fulfil an approved payment. Runs inside the same transaction that approved it, so it can't run twice.
-- Any money that can't be turned into a booking becomes a refund the club owes. Never lost.
create or replace function public.apply_payment(p_payment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record; b record; s record; outcome text;
begin
  select * into p from payments where id = p_payment;
  if p.status <> 'approved' then raise exception 'apply_payment on a % payment', p.status; end if;

  if p.purpose = 'session_booking' then
    select * into b from session_bookings where id = p.purpose_id;
    select * into s from sessions where id = b.session_id for update;
    select * into b from session_bookings where id = p.purpose_id for update;

    if b.status in ('pending_payment','waitlist_pending_payment') then
      update session_bookings set paid_amount = paid_amount + p.amount where id = b.id;
      if b.paid_amount + p.amount >= b.amount then
        update session_bookings set status = case when b.status = 'pending_payment' then 'confirmed' else 'waitlisted' end,
          hold_expires_at = null where id = b.id;
        outcome := case when b.status = 'pending_payment' then 'confirmed' else 'waitlisted' end;
        if outcome = 'waitlisted' then perform promote_waitlist(b.session_id); end if;
      else
        outcome := 'partially_paid';
      end if;
    elsif b.status = 'expired' and s.status = 'scheduled' and s.starts_at > now() then
      -- paid after the hold lapsed: seat if one is free, else waitlist, else refund
      update session_bookings set paid_amount = paid_amount + p.amount where id = b.id;
      if s.capacity - seats_taken(s.id) >= b.seats then
        update session_bookings set status = 'confirmed', hold_expires_at = null where id = b.id;
        outcome := 'confirmed_late';
      elsif s.waitlist_enabled then
        update session_bookings set status = 'waitlisted', hold_expires_at = null where id = b.id;
        outcome := 'waitlisted_late';
      else
        update session_bookings set paid_amount = paid_amount - p.amount where id = b.id;
        perform owe_refund(p.club_id, p.user_id, p.id, p.purpose, b.id, p.amount,
          'Paid after the hold expired and the session filled up');
        outcome := 'refund_owed';
      end if;
    else
      perform owe_refund(p.club_id, p.user_id, p.id, p.purpose, b.id, p.amount,
        case when b.status in ('confirmed','waitlisted') then 'Paid twice for the same booking'
             else 'Paid for a booking that is ' || b.status end);
      outcome := 'refund_owed';
    end if;

  elsif p.purpose = 'court_booking' then
    select * into b from court_bookings where id = p.purpose_id for update;
    if b.status = 'pending_payment' then
      update court_bookings set paid_amount = paid_amount + p.amount,
        status = case when paid_amount + p.amount >= amount then 'confirmed' else status end,
        hold_expires_at = case when paid_amount + p.amount >= amount then null else hold_expires_at end
      where id = b.id;
      outcome := 'confirmed';
    elsif b.status = 'expired' and b.starts_at > now() then
      begin
        insert into court_reservations (club_id, court_id, period, source, source_id)
        values (b.club_id, b.court_id, tstzrange(b.starts_at, b.ends_at), 'rental', b.id);
        update court_bookings set status = 'confirmed', paid_amount = paid_amount + p.amount, hold_expires_at = null where id = b.id;
        outcome := 'confirmed_late';
      exception when exclusion_violation then
        perform owe_refund(p.club_id, p.user_id, p.id, p.purpose, b.id, p.amount,
          'Paid after the hold expired and the court was taken');
        outcome := 'refund_owed';
      end;
    else
      perform owe_refund(p.club_id, p.user_id, p.id, p.purpose, b.id, p.amount,
        case when b.status = 'confirmed' then 'Paid twice for the same booking'
             else 'Paid for a booking that is ' || b.status end);
      outcome := 'refund_owed';
    end if;
  end if;
  return jsonb_build_object('outcome', outcome);
end $$;

-- GCash transfer: the player has uploaded a screenshot. Creates the payment and keeps the hold while it's checked.
create or replace function public.submit_receipt(p_purpose text, p_booking uuid, p_proof_path text, p_reported_ref text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); x record; pid uuid; gnum text;
begin
  select * into x from payable(p_purpose, p_booking);
  if x.user_id <> me then raise exception 'Booking not found'; end if;
  select gcash_number into gnum from clubs where id = x.club_id;
  if gnum is null then raise exception 'This club hasn''t set up GCash payments'; end if;
  if p_proof_path is null or split_part(p_proof_path, '/', 1) <> me::text then
    raise exception 'Upload your receipt screenshot first';
  end if;
  if exists (select 1 from payments where purpose = p_purpose and purpose_id = p_booking
             and method = 'gcash_receipt' and status in ('pending','review')) then
    raise exception 'A receipt for this booking is already being checked';
  end if;
  insert into payments (club_id, user_id, purpose, purpose_id, amount, method, status, proof_path, reported_reference)
  values (x.club_id, me, p_purpose, p_booking, x.due, 'gcash_receipt', 'pending', p_proof_path, nullif(trim(p_reported_ref), ''))
  returning id into pid;
  perform extend_hold(p_purpose, p_booking, now() + make_interval(mins => cfg('receipt_hold_minutes','120')::int));
  return pid;
end $$;

-- Called only by the verify-receipt function (service role) with what the AI read.
-- p_verdict: 'approved' (all checks passed) | 'flagged' (needs a person) | 'error'
create or replace function public.record_receipt_check(p_payment uuid, p_verdict text, p_notes text,
  p_extracted jsonb, p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record; norm text := nullif(regexp_replace(coalesce(p_reference, ''), '\D', '', 'g'), ''); dup record; res jsonb;
begin
  select * into p from payments where id = p_payment for update;
  if p is null or p.method <> 'gcash_receipt' then raise exception 'Payment not found'; end if;
  if p.status not in ('pending','review') then return jsonb_build_object('already', p.status); end if;
  if norm is not null and length(norm) < 6 then norm := null; end if;

  if norm is not null then
    select py.id, py.club_id, c.name as club_name into dup from payments py join clubs c on c.id = py.club_id
    where py.receipt_ref_norm = norm and py.status = 'approved' and py.id <> p_payment limit 1;
    if dup.id is not null then
      update payments set status = 'rejected', ai_verdict = 'duplicate', extracted = p_extracted,
        ai_notes = 'This receipt (ref ' || norm || ') was already used for another payment'
                   || case when dup.club_id <> p.club_id then ' at ' || dup.club_name else '' end || E'.\n' || coalesce(p_notes,''),
        reported_reference = coalesce(reported_reference, p_reference)
      where id = p_payment;
      perform extend_hold(p.purpose, p.purpose_id, now() + make_interval(mins => hold_minutes()));
      return jsonb_build_object('result', 'duplicate');
    end if;
  end if;

  if p_verdict = 'approved' and norm is not null then
    update payments set status = 'approved', ai_verdict = 'approved', ai_notes = p_notes, extracted = p_extracted,
      receipt_ref_norm = norm, reported_reference = coalesce(reported_reference, p_reference), paid_at = now()
    where id = p_payment;
    res := apply_payment(p_payment);
    return jsonb_build_object('result', 'approved') || res;
  end if;

  update payments set status = 'review', ai_verdict = case when p_verdict = 'error' then 'error' else 'flagged' end,
    ai_notes = p_notes, extracted = p_extracted, reported_reference = coalesce(reported_reference, p_reference)
  where id = p_payment;
  return jsonb_build_object('result', 'review');
end $$;

-- A person decides on a flagged receipt. Always logged.
create or replace function public.review_payment(p_payment uuid, p_approve boolean, p_note text,
  p_reference text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record; norm text; res jsonb := '{}'::jsonb;
begin
  select * into p from payments where id = p_payment for update;
  if p is null or not is_club_staff(p.club_id) then raise exception 'Not allowed'; end if;
  if p.method <> 'gcash_receipt' then raise exception 'Only receipt payments are reviewed here'; end if;
  if p.status not in ('pending','review') then raise exception 'This payment is already %', p.status; end if;
  if length(trim(coalesce(p_note,''))) < 3 then raise exception 'Please add a short note'; end if;
  if p_approve then
    norm := nullif(regexp_replace(coalesce(p_reference, p.extracted->>'detected_reference', p.reported_reference, ''), '\D', '', 'g'), '');
    if norm is not null and length(norm) < 6 then norm := null; end if;
    if norm is not null and exists (select 1 from payments where receipt_ref_norm = norm and status = 'approved') then
      raise exception 'Reference % was already used for another payment', norm;
    end if;
    update payments set status = 'approved', receipt_ref_norm = norm, reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = p_note, paid_at = now() where id = p_payment;
    res := apply_payment(p_payment);
  else
    update payments set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
    where id = p_payment;
    perform extend_hold(p.purpose, p.purpose_id, now() + make_interval(mins => hold_minutes()));
  end if;
  perform audit(p.club_id, case when p_approve then 'payment.approve' else 'payment.reject' end, 'payment', p_payment,
    jsonb_build_object('note', p_note, 'amount', p.amount) || res);
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end) || res;
end $$;

-- Staff took cash (or a transfer outside the app) for a booking.
create or replace function public.record_cash_payment(p_purpose text, p_booking uuid, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid; uid uuid; pid uuid; res jsonb;
begin
  if p_purpose = 'session_booking' then select club_id, user_id into cid, uid from session_bookings where id = p_booking;
  else select club_id, user_id into cid, uid from court_bookings where id = p_booking; end if;
  if cid is null or not is_club_staff(cid) then raise exception 'Not allowed'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Enter the amount received'; end if;
  if length(trim(coalesce(p_note,''))) < 3 then raise exception 'Please add a short note'; end if;
  insert into payments (club_id, user_id, purpose, purpose_id, amount, method, status, reviewed_by, reviewed_at, review_note, paid_at)
  values (cid, uid, p_purpose, p_booking, p_amount, 'cash', 'approved', auth.uid(), now(), p_note, now())
  returning id into pid;
  res := apply_payment(pid);
  perform audit(cid, 'payment.cash', 'payment', pid, jsonb_build_object('amount', p_amount, 'note', p_note) || res);
  return res;
end $$;

-- TechPay: called by the techpay function with the PLAYER's token.
create or replace function public.start_gateway_payment(p_purpose text, p_booking uuid, p_reference text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); x record; live text; cl record; pid uuid;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  select * into x from payable(p_purpose, p_booking);
  if x.user_id <> me then raise exception 'Booking not found'; end if;
  select * into cl from clubs where id = x.club_id;
  if not cl.techpay_enabled then raise exception 'Instant pay isn''t set up for this club yet'; end if;
  live := cfg('gateway_live', 'false');
  if live = 'false' then raise exception 'Instant pay is not available yet'; end if;
  if live = 'admins' and not is_club_staff(x.club_id) then raise exception 'Instant pay is being trialled by club staff first'; end if;
  if p_reference !~ ('^CS' || cl.short_code || '[A-Z0-9]{6,}$') then raise exception 'Bad reference'; end if;
  insert into payments (club_id, user_id, purpose, purpose_id, amount, method, status, gateway_ref, gateway_status,
    is_test)
  values (x.club_id, me, p_purpose, p_booking, x.due, 'techpay', 'pending', p_reference, 'pending',
    cfg('techpay_sandbox', 'true')::boolean)
  returning id into pid;
  perform extend_hold(p_purpose, p_booking, now() + make_interval(mins => hold_minutes()));
  return jsonb_build_object('ok', true, 'id', pid, 'reference', p_reference, 'amount', x.due,
    'merchant_code', cl.techpay_merchant_code);
end $$;

-- TechPay: called by the techpay function with the SERVICE key and VERIFIED values only.
create or replace function public.settle_gateway_payment(p_reference text, p_amount numeric, p_status text,
  p_fee numeric default null, p_payload jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; res jsonb;
begin
  select * into t from payments where gateway_ref = p_reference for update;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown reference'); end if;
  if t.status = 'approved' then return jsonb_build_object('ok', true, 'already', true); end if;
  if p_status = 'completed' then
    if abs(coalesce(p_amount, 0) - t.amount) > 0.005 then
      update payments set status = 'review', gateway_status = p_status, gateway_payload = p_payload,
        review_note = 'Gateway reported ₱' || p_amount || ' against ₱' || t.amount || ' — held for review'
      where id = t.id;
      return jsonb_build_object('ok', false, 'reason', 'amount mismatch');
    end if;
    update payments set status = 'approved', gateway_status = p_status, gateway_fee = p_fee,
      gateway_payload = p_payload, paid_at = now() where id = t.id;
    res := apply_payment(t.id);
    return jsonb_build_object('ok', true) || res;
  elsif p_status = 'cancelled' then
    update payments set status = 'rejected', gateway_status = p_status, gateway_payload = p_payload,
      review_note = 'Cancelled or expired at the gateway' where id = t.id and status <> 'approved';
    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;
  update payments set gateway_status = p_status, gateway_payload = p_payload where id = t.id;
  return jsonb_build_object('ok', true, 'pending', true);
end $$;

create or replace function public.log_gateway_webhook(p_ip text, p_reference text, p_amount numeric,
  p_status text, p_sig_recv text, p_sig_exp text, p_ok boolean, p_outcome text, p_payload jsonb)
returns void language sql security definer set search_path = public as $$
  insert into gateway_webhook_log (source_ip, reference, amount, status, signature_received,
    signature_expected, signature_ok, outcome, payload)
  values (p_ip, p_reference, p_amount, p_status, p_sig_recv, p_sig_exp, p_ok, p_outcome, p_payload);
$$;

-- ════════════════════════════════════════════════════════════ refunds

create or replace function public.settle_refund(p_refund uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from refunds where id = p_refund for update;
  if r is null or not is_club_admin(r.club_id) then raise exception 'Not allowed'; end if;
  if r.status <> 'owed' then raise exception 'This refund is already %', r.status; end if;
  if p_status not in ('paid','waived') then raise exception 'Choose paid or waived'; end if;
  if length(trim(coalesce(p_note,''))) < 3 then
    raise exception 'Add a note (e.g. the GCash reference you sent the refund with)';
  end if;
  update refunds set status = p_status, settled_by = auth.uid(), settled_at = now(), settle_note = p_note where id = p_refund;
  perform audit(r.club_id, 'refund.' || p_status, 'refund', p_refund, jsonb_build_object('amount', r.amount, 'note', p_note));
end $$;

-- ════════════════════════════════════════════════════════════ hourly job

create or replace function public.run_maintenance() returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; s record; p record; n_seat int := 0; n_court int := 0; n_wait int := 0; n_alert int := 0; sess uuid;
begin
  -- 1. lapsed seat holds (not while a person is reviewing a receipt)
  for b in select sb.* from session_bookings sb
           where sb.status in ('pending_payment','waitlist_pending_payment') and sb.hold_expires_at < now()
             and not exists (select 1 from payments py where py.purpose = 'session_booking' and py.purpose_id = sb.id
                             and py.status = 'review')
           for update skip locked loop
    update session_bookings set status = 'expired', hold_expires_at = null where id = b.id;
    if b.paid_amount > 0 then
      perform owe_refund(b.club_id, b.user_id, null, 'session_booking', b.id, b.paid_amount, 'Part-paid booking expired');
    end if;
    n_seat := n_seat + 1;
  end loop;
  for sess in select distinct session_id from session_bookings where status = 'waitlisted' loop
    perform promote_waitlist(sess);
  end loop;

  -- 2. lapsed court holds
  for b in select cb.* from court_bookings cb
           where cb.status = 'pending_payment' and cb.hold_expires_at < now()
             and not exists (select 1 from payments py where py.purpose = 'court_booking' and py.purpose_id = cb.id
                             and py.status = 'review')
           for update skip locked loop
    update court_bookings set status = 'expired', hold_expires_at = null where id = b.id;
    update court_reservations set active = false where source = 'rental' and source_id = b.id;
    if b.paid_amount > 0 then
      perform owe_refund(b.club_id, b.user_id, null, 'court_booking', b.id, b.paid_amount, 'Part-paid booking expired');
    end if;
    n_court := n_court + 1;
  end loop;

  -- 3. sessions that have started: waitlist deposits go back, unpaid holds lapse
  for s in select * from sessions where status = 'scheduled' and starts_at <= now() for update skip locked loop
    for b in select * from session_bookings where session_id = s.id
             and status in ('waitlisted','waitlist_pending_payment','pending_payment') for update loop
      update session_bookings set status = 'expired', hold_expires_at = null where id = b.id;
      if b.paid_amount > 0 then
        perform owe_refund(b.club_id, b.user_id, null, 'session_booking', b.id, b.paid_amount,
          'Waitlist place for ' || s.title || ' didn''t open up. Deposit returned.');
        n_wait := n_wait + 1;
      end if;
    end loop;
    if s.ends_at <= now() then update sessions set status = 'completed' where id = s.id; end if;
  end loop;

  -- 4. paid but not booked: an approved payment whose booking isn't live and that no refund covers
  for p in select py.* from payments py
           where py.status = 'approved' and py.paid_at > now() - interval '60 days'
             and not exists (select 1 from refunds r where r.payment_id = py.id)
             and (
               (py.purpose = 'session_booking' and exists (select 1 from session_bookings sb where sb.id = py.purpose_id
                  and sb.status not in ('confirmed','waitlisted') and sb.paid_amount > 0
                  and not exists (select 1 from refunds r2 where r2.purpose_id = sb.id)))
            or (py.purpose = 'court_booking' and exists (select 1 from court_bookings cb where cb.id = py.purpose_id
                  and cb.status <> 'confirmed' and cb.paid_amount > 0
                  and not exists (select 1 from refunds r2 where r2.purpose_id = cb.id)))
             ) loop
    insert into alerts (club_id, kind, target_type, target_id, message)
    values (p.club_id, 'paid_not_booked', 'payment', p.id,
      '₱' || p.amount || ' payment has no live booking and no refund. Check it.')
    on conflict (kind, target_id) do nothing;
    n_alert := n_alert + 1;
  end loop;

  -- 5. refunds owed for more than 3 days
  insert into alerts (club_id, kind, target_type, target_id, message)
  select r.club_id, 'refund_overdue', 'refund', r.id, '₱' || r.amount || ' refund owed for over 3 days'
  from refunds r where r.status = 'owed' and r.created_at < now() - interval '3 days'
  on conflict (kind, target_id) do nothing;
  update alerts a set resolved_at = now() where a.kind = 'refund_overdue' and a.resolved_at is null
    and exists (select 1 from refunds r where r.id = a.target_id and r.status <> 'owed');

  return jsonb_build_object('seat_holds_expired', n_seat, 'court_holds_expired', n_court,
    'waitlist_refunds', n_wait, 'paid_not_booked', n_alert);
end $$;
