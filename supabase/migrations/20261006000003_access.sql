-- Courtside access: RLS for reads, read-model functions, grants. Clients never write tables directly.

alter table public.app_config enable row level security;
alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.memberships enable row level security;
alter table public.club_role_rules enable row level security;
alter table public.house_rules enable row level security;
alter table public.courts enable row level security;
alter table public.club_hours enable row level security;
alter table public.rate_rules enable row level security;
alter table public.court_reservations enable row level security;
alter table public.sessions enable row level security;
alter table public.session_bookings enable row level security;
alter table public.court_bookings enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.audit_log enable row level security;
alter table public.alerts enable row level security;
alter table public.gateway_webhook_log enable row level security;

-- public club info
create policy clubs_read on public.clubs for select using (is_published or is_club_staff(id));
create policy courts_read on public.courts for select using (
  exists (select 1 from clubs c where c.id = club_id and (c.is_published or is_club_staff(c.id))));
create policy hours_read on public.club_hours for select using (true);
create policy rates_read on public.rate_rules for select using (true);
create policy role_rules_read on public.club_role_rules for select using (true);
create policy house_rules_read on public.house_rules for select using (true);
create policy sessions_read on public.sessions for select using (
  exists (select 1 from clubs c where c.id = club_id and (c.is_published or is_club_staff(c.id))));
create policy app_config_read on public.app_config for select using (key in ('gateway_live','fee_qrph','fee_card','hold_minutes'));

-- people
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_staff on public.profiles for select to authenticated using (
  exists (select 1 from memberships m where m.user_id = profiles.id and is_club_staff(m.club_id)));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- players may edit only their name and phone
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create policy memberships_self on public.memberships for select to authenticated using (user_id = auth.uid());
create policy memberships_staff on public.memberships for select to authenticated using (is_club_staff(club_id));

-- bookings & money: own rows, or staff of that club
create policy sb_self on public.session_bookings for select to authenticated using (user_id = auth.uid());
create policy sb_staff on public.session_bookings for select to authenticated using (is_club_staff(club_id));
create policy cb_self on public.court_bookings for select to authenticated using (user_id = auth.uid());
create policy cb_staff on public.court_bookings for select to authenticated using (is_club_staff(club_id));
create policy pay_self on public.payments for select to authenticated using (user_id = auth.uid());
create policy pay_staff on public.payments for select to authenticated using (is_club_staff(club_id));
create policy ref_self on public.refunds for select to authenticated using (user_id = auth.uid());
create policy ref_staff on public.refunds for select to authenticated using (is_club_staff(club_id));
create policy audit_admin on public.audit_log for select to authenticated using (is_club_admin(club_id));
create policy alerts_staff on public.alerts for select to authenticated using (is_club_staff(club_id));
create policy reservations_staff on public.court_reservations for select to authenticated using (is_club_staff(club_id));
-- gateway_webhook_log: no client policy (platform team reads it via the dashboard/SQL)

-- ── read models ─────────────────────────────────────────────────────────

-- Upcoming sessions with seat counts (public).
create or replace function public.list_sessions(p_club uuid, p_from timestamptz default now(), p_days int default 14)
returns table (id uuid, title text, description text, starts_at timestamptz, ends_at timestamptz, fee numeric,
  capacity int, seats_taken int, waitlist_seats int, level text, status text, waitlist_enabled boolean, court_names text[])
language sql stable security definer set search_path = public as $$
  select s.id, s.title, s.description, s.starts_at, s.ends_at, s.fee, s.capacity,
    seats_taken(s.id),
    coalesce((select sum(b.seats) from session_bookings b where b.session_id = s.id and b.status = 'waitlisted'), 0)::int,
    s.level, s.status, s.waitlist_enabled,
    coalesce((select array_agg(c.name order by c.sort, c.name) from courts c where c.id = any(s.court_ids)), '{}')
  from sessions s join clubs cl on cl.id = s.club_id
  where s.club_id = p_club and (cl.is_published or is_club_staff(cl.id))
    and s.ends_at >= p_from and s.starts_at < p_from + make_interval(days => p_days)
  order by s.starts_at
$$;

-- Who's playing (first names only) — players like to see who's coming.
create or replace function public.session_players(p_session uuid)
returns table (first_name text, guests int, waitlisted boolean)
language sql stable security definer set search_path = public as $$
  select split_part(p.full_name, ' ', 1), coalesce(array_length(b.guest_names, 1), 0), b.status = 'waitlisted'
  from session_bookings b join profiles p on p.id = b.user_id
  where b.session_id = p_session and b.status in ('confirmed','waitlisted')
  order by b.status, b.created_at
$$;

-- Host's roster for the day.
create or replace function public.session_roster(p_session uuid)
returns table (booking_id uuid, user_id uuid, full_name text, phone text, role public.club_role, guest_names text[],
  seats int, status text, amount numeric, paid_amount numeric, checked_in_at timestamptz, created_at timestamptz,
  pending_payment_id uuid, pending_payment_status text)
language plpgsql stable security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from sessions where id = p_session;
  if c is null or not is_club_staff(c) then raise exception 'Not allowed'; end if;
  return query
  select b.id, b.user_id, p.full_name, p.phone, m.role, b.guest_names, b.seats, b.status, b.amount, b.paid_amount,
    b.checked_in_at, b.created_at,
    (select py.id from payments py where py.purpose = 'session_booking' and py.purpose_id = b.id
       and py.status in ('pending','review') order by py.created_at desc limit 1),
    (select py.status from payments py where py.purpose = 'session_booking' and py.purpose_id = b.id
       and py.status in ('pending','review') order by py.created_at desc limit 1)
  from session_bookings b
  join profiles p on p.id = b.user_id
  left join memberships m on m.club_id = b.club_id and m.user_id = b.user_id
  where b.session_id = p_session and b.status not in ('expired')
  order by case b.status when 'confirmed' then 0 when 'pending_payment' then 1 when 'waitlisted' then 2
                         when 'waitlist_pending_payment' then 3 else 4 end, b.created_at;
end $$;

-- Club money summary for a period (admins).
create or replace function public.club_dashboard(p_club uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_club_admin(p_club) then raise exception 'Not allowed'; end if;
  select jsonb_build_object(
    'received', coalesce((select sum(amount) from payments where club_id = p_club and status = 'approved'
                          and paid_at >= p_from and paid_at < p_to and not is_test), 0),
    'received_by_method', coalesce((select jsonb_object_agg(method, total) from (
        select method, sum(amount) total from payments where club_id = p_club and status = 'approved'
          and paid_at >= p_from and paid_at < p_to and not is_test group by method) x), '{}'::jsonb),
    'received_sessions', coalesce((select sum(amount) from payments where club_id = p_club and status = 'approved'
                          and purpose = 'session_booking' and paid_at >= p_from and paid_at < p_to and not is_test), 0),
    'received_courts', coalesce((select sum(amount) from payments where club_id = p_club and status = 'approved'
                          and purpose = 'court_booking' and paid_at >= p_from and paid_at < p_to and not is_test), 0),
    'gateway_fees', coalesce((select sum(gateway_fee) from payments where club_id = p_club and status = 'approved'
                          and method = 'techpay' and paid_at >= p_from and paid_at < p_to and not is_test), 0),
    'refunds_owed', coalesce((select sum(amount) from refunds where club_id = p_club and status = 'owed'), 0),
    'refunds_owed_count', (select count(*) from refunds where club_id = p_club and status = 'owed'),
    'refunds_paid', coalesce((select sum(amount) from refunds where club_id = p_club and status = 'paid'
                          and settled_at >= p_from and settled_at < p_to), 0),
    'to_review', (select count(*) from payments where club_id = p_club and status = 'review'),
    'awaiting_payment', coalesce((select sum(amount - paid_amount) from session_bookings where club_id = p_club
                          and status in ('pending_payment','waitlist_pending_payment')), 0)
                        + coalesce((select sum(amount - paid_amount) from court_bookings where club_id = p_club
                          and status = 'pending_payment'), 0),
    'open_alerts', (select count(*) from alerts where club_id = p_club and resolved_at is null),
    'sessions', (select count(*) from sessions where club_id = p_club and starts_at >= p_from and starts_at < p_to and status <> 'cancelled'),
    'seats_sold', coalesce((select sum(b.seats) from session_bookings b join sessions s on s.id = b.session_id
                          where b.club_id = p_club and b.status = 'confirmed' and s.starts_at >= p_from and s.starts_at < p_to), 0),
    'court_hours', coalesce((select round(sum(extract(epoch from (ends_at - starts_at)) / 3600)::numeric, 1)
                          from court_bookings where club_id = p_club and status = 'confirmed'
                          and starts_at >= p_from and starts_at < p_to), 0),
    'members', (select count(*) from memberships where club_id = p_club and role not in ('pending','banned'))
  ) into r;
  return r;
end $$;

-- Payments queue / ledger for staff, with player names.
create or replace function public.club_payments(p_club uuid, p_status text default null, p_limit int default 100)
returns table (id uuid, user_id uuid, full_name text, purpose text, purpose_id uuid, label text, amount numeric,
  method text, status text, gateway_ref text, gateway_fee numeric, proof_path text, reported_reference text,
  receipt_ref_norm text, extracted jsonb, ai_verdict text, ai_notes text, review_note text, reviewed_by_name text,
  paid_at timestamptz, created_at timestamptz, is_test boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_club_staff(p_club) then raise exception 'Not allowed'; end if;
  return query
  select py.id, py.user_id, pr.full_name, py.purpose, py.purpose_id,
    case when py.purpose = 'session_booking' then
      (select s.title || ' · ' || to_char(s.starts_at at time zone 'Asia/Manila', 'Dy DD Mon HH12:MI AM')
       from session_bookings b join sessions s on s.id = b.session_id where b.id = py.purpose_id)
    else
      (select c.name || ' · ' || to_char(cb.starts_at at time zone 'Asia/Manila', 'Dy DD Mon HH12:MI AM')
       from court_bookings cb join courts c on c.id = cb.court_id where cb.id = py.purpose_id)
    end,
    py.amount, py.method, py.status, py.gateway_ref, py.gateway_fee, py.proof_path, py.reported_reference,
    py.receipt_ref_norm, py.extracted, py.ai_verdict, py.ai_notes, py.review_note, rv.full_name,
    py.paid_at, py.created_at, py.is_test
  from payments py join profiles pr on pr.id = py.user_id left join profiles rv on rv.id = py.reviewed_by
  where py.club_id = p_club and (p_status is null or py.status = p_status)
  order by case when py.status = 'review' then 0 else 1 end, py.created_at desc
  limit p_limit;
end $$;

create or replace function public.club_refunds(p_club uuid, p_status text default 'owed')
returns table (id uuid, user_id uuid, full_name text, phone text, amount numeric, reason text, status text,
  settle_note text, settled_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_club_staff(p_club) then raise exception 'Not allowed'; end if;
  return query
  select r.id, r.user_id, p.full_name, p.phone, r.amount, r.reason, r.status, r.settle_note, r.settled_at, r.created_at
  from refunds r join profiles p on p.id = r.user_id
  where r.club_id = p_club and (p_status is null or r.status = p_status)
  order by r.created_at desc;
end $$;

create or replace function public.club_members(p_club uuid)
returns table (user_id uuid, full_name text, phone text, role public.club_role, note text, joined_at timestamptz,
  rules_version_accepted int, bookings int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_club_staff(p_club) then raise exception 'Not allowed'; end if;
  return query
  select m.user_id, p.full_name, p.phone, m.role, m.note, m.joined_at, m.rules_version_accepted,
    (select count(*)::int from session_bookings b where b.club_id = p_club and b.user_id = m.user_id and b.status = 'confirmed')
  from memberships m join profiles p on p.id = m.user_id
  where m.club_id = p_club
  order by case m.role when 'pending' then 0 else 1 end, p.full_name;
end $$;

-- Find a player by phone or email to add a walk-in. Exact match only (no browsing other clubs' players).
create or replace function public.find_player(p_club uuid, p_query text)
returns table (user_id uuid, full_name text, phone text)
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_query, ''));
begin
  if not is_club_staff(p_club) then raise exception 'Not allowed'; end if;
  return query
  select p.id, p.full_name, p.phone from profiles p left join auth.users u on u.id = p.id
  where (length(regexp_replace(q, '\D', '', 'g')) >= 10 and regexp_replace(coalesce(p.phone,''), '\D', '', 'g') like '%' || right(regexp_replace(q, '\D', '', 'g'), 10))
     or lower(u.email) = lower(q)
  limit 5;
end $$;

-- A player's whole money history across clubs: "where did my money go?"
create or replace function public.my_money()
returns table (at timestamptz, club_name text, kind text, label text, amount numeric, status text, method text, note text)
language sql stable security definer set search_path = public as $$
  select py.created_at, c.name, 'payment',
    case when py.purpose = 'session_booking' then
      (select s.title || ' · ' || to_char(s.starts_at at time zone 'Asia/Manila', 'DD Mon') from session_bookings b join sessions s on s.id = b.session_id where b.id = py.purpose_id)
    else (select ct.name || ' · ' || to_char(cb.starts_at at time zone 'Asia/Manila', 'DD Mon HH12:MI AM') from court_bookings cb join courts ct on ct.id = cb.court_id where cb.id = py.purpose_id) end,
    py.amount, py.status, py.method,
    coalesce(py.review_note, case when py.status = 'review' then 'Being checked by the club' end)
  from payments py join clubs c on c.id = py.club_id where py.user_id = auth.uid()
  union all
  select r.created_at, c.name, 'refund', r.reason, r.amount, r.status, null,
    case when r.status = 'paid' then 'Sent: ' || coalesce(r.settle_note, '') else null end
  from refunds r join clubs c on c.id = r.club_id where r.user_id = auth.uid()
  order by 1 desc
$$;

create or replace function public.my_bookings()
returns table (kind text, id uuid, club_id uuid, club_name text, club_slug text, title text, starts_at timestamptz,
  ends_at timestamptz, status text, amount numeric, paid_amount numeric, guest_names text[], hold_expires_at timestamptz,
  payment_status text)
language sql stable security definer set search_path = public as $$
  select 'session', b.id, b.club_id, c.name, c.slug, s.title, s.starts_at, s.ends_at, b.status, b.amount, b.paid_amount,
    b.guest_names, b.hold_expires_at,
    (select py.status from payments py where py.purpose = 'session_booking' and py.purpose_id = b.id order by py.created_at desc limit 1)
  from session_bookings b join sessions s on s.id = b.session_id join clubs c on c.id = b.club_id
  where b.user_id = auth.uid() and s.ends_at > now() - interval '30 days'
  union all
  select 'court', cb.id, cb.club_id, c.name, c.slug, ct.name, cb.starts_at, cb.ends_at, cb.status, cb.amount, cb.paid_amount,
    '{}'::text[], cb.hold_expires_at,
    (select py.status from payments py where py.purpose = 'court_booking' and py.purpose_id = cb.id order by py.created_at desc limit 1)
  from court_bookings cb join courts ct on ct.id = cb.court_id join clubs c on c.id = cb.club_id
  where cb.user_id = auth.uid() and cb.ends_at > now() - interval '30 days'
  order by 7
$$;

-- Court rentals in a day, with renter names, for staff.
create or replace function public.club_court_day(p_club uuid, p_day date)
returns table (reservation_id uuid, court_id uuid, starts_at timestamptz, ends_at timestamptz, kind text, source_id uuid,
  label text, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_club_staff(p_club) then raise exception 'Not allowed'; end if;
  return query
  select r.id, r.court_id, lower(r.period), upper(r.period), r.source, r.source_id,
    case r.source when 'session' then (select s.title from sessions s where s.id = r.source_id)
                  when 'rental' then (select p.full_name from court_bookings cb join profiles p on p.id = cb.user_id where cb.id = r.source_id)
                  else 'Blocked' end,
    case r.source when 'rental' then (select cb.status from court_bookings cb where cb.id = r.source_id) else 'confirmed' end
  from court_reservations r join clubs c on c.id = r.club_id
  where r.club_id = p_club and r.active
    and r.period && tstzrange((p_day::timestamp at time zone c.timezone), ((p_day + 1)::timestamp at time zone c.timezone));
end $$;

create or replace function public.resolve_alert(p_alert bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from alerts where id = p_alert;
  if a is null or not is_club_admin(a.club_id) then raise exception 'Not allowed'; end if;
  update alerts set resolved_at = now() where id = p_alert;
  perform audit(a.club_id, 'alert.resolve', 'alert', null, jsonb_build_object('alert', p_alert, 'note', p_note));
end $$;

-- ── grants ──────────────────────────────────────────────────────────────
-- Tables: read via RLS only. No direct writes (except profile name/phone above).
grant select on all tables in schema public to anon, authenticated;
revoke insert, update, delete on all tables in schema public from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
revoke select on public.gateway_webhook_log from anon, authenticated;

-- Functions: lock everything down, then open the client API explicitly.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.cfg(text, text),
  public.list_sessions(uuid, timestamptz, int),
  public.session_players(uuid),
  public.court_availability(uuid, date),
  public.court_price(uuid, timestamptz, timestamptz),
  public.my_role(uuid), public.is_club_staff(uuid), public.is_club_admin(uuid), public.is_platform_admin()
to anon, authenticated;

grant execute on function
  public.create_club(text, text, text, text, uuid),
  public.update_club(uuid, jsonb),
  public.join_club(uuid),
  public.publish_house_rules(uuid, text),
  public.accept_house_rules(uuid, int),
  public.set_member_role(uuid, uuid, public.club_role, text),
  public.set_role_rule(uuid, public.club_role, int, int),
  public.upsert_court(uuid, uuid, text, numeric, text, boolean, boolean, int),
  public.set_club_hours(uuid, jsonb),
  public.save_rate_rule(uuid, uuid, text, uuid, int[], time, time, numeric, int),
  public.delete_rate_rule(uuid),
  public.block_court(uuid, timestamptz, timestamptz, text),
  public.unblock_court(uuid),
  public.create_session(uuid, text, timestamptz, timestamptz, numeric, int, uuid[], text, text, boolean, int, uuid),
  public.update_session(uuid, jsonb),
  public.book_session(uuid, text[]),
  public.cancel_session_booking(uuid),
  public.staff_cancel_session_booking(uuid, boolean, text),
  public.cancel_session(uuid, text),
  public.check_in(uuid, boolean),
  public.staff_add_to_session(uuid, uuid, text[], numeric, text, boolean),
  public.book_court(uuid, timestamptz, timestamptz),
  public.cancel_court_booking(uuid),
  public.staff_cancel_court_booking(uuid, boolean, text),
  public.submit_receipt(text, uuid, text, text),
  public.review_payment(uuid, boolean, text, text),
  public.record_cash_payment(text, uuid, numeric, text),
  public.start_gateway_payment(text, uuid, text),
  public.settle_refund(uuid, text, text),
  public.session_roster(uuid),
  public.club_dashboard(uuid, timestamptz, timestamptz),
  public.club_payments(uuid, text, int),
  public.club_refunds(uuid, text),
  public.club_members(uuid),
  public.find_player(uuid, text),
  public.my_money(),
  public.my_bookings(),
  public.club_court_day(uuid, date),
  public.resolve_alert(bigint, text)
to authenticated;

-- Service-role only (edge functions / cron)
grant execute on function
  public.record_receipt_check(uuid, text, text, jsonb, text),
  public.settle_gateway_payment(text, numeric, text, numeric, jsonb),
  public.log_gateway_webhook(text, text, numeric, text, text, text, boolean, text, jsonb),
  public.run_maintenance()
to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
