-- Courtside core schema
-- Every club-owned row carries club_id. Players are global; memberships link a player to a club.
-- Writes go through security-definer functions (business rules live here, not in the app).
-- Direct table writes are not granted to clients.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────────────────────────────────────────── config
create table public.app_config (
  key text primary key,
  value text not null
);
insert into public.app_config(key, value) values
  ('gateway_live', 'admins'),        -- 'false' | 'admins' | 'true' : TechPay staged rollout
  ('fee_qrph', '0.0175'),            -- display only; TechPay applies the real fee
  ('fee_card', '0.03'),
  ('hold_minutes', '15'),            -- seat / court hold while the player pays
  ('receipt_hold_minutes', '120')    -- hold kept while a GCash receipt waits for review
on conflict (key) do nothing;

create or replace function public.cfg(p_key text, p_default text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_config where key = p_key), p_default)
$$;

-- ─────────────────────────────────────────────────────────────── people
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,                         -- mobile; also where clubs send refunds
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────── clubs
create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  short_code text not null unique check (short_code ~ '^[A-Z0-9]{2,6}$'), -- in payment references
  name text not null,
  tagline text,
  venue_name text,
  address text,
  city text,
  timezone text not null default 'Asia/Manila',
  -- payments
  gcash_number text,                  -- club's own GCash for free transfers (receipt AI check)
  gcash_name text,
  techpay_enabled boolean not null default false,
  techpay_merchant_code text,         -- sub-merchant id from TechPay onboarding
  platform_fee_pct numeric(5,4) not null default 0,  -- for monthly invoicing (reporting only in v1)
  -- policies
  join_policy text not null default 'open' check (join_policy in ('open','approval')),
  refund_cutoff_hours int not null default 24 check (refund_cutoff_hours between 0 and 336),
  court_booking_days_ahead int not null default 14 check (court_booking_days_ahead between 1 and 90),
  court_min_minutes int not null default 60 check (court_min_minutes in (30,60,90,120)),
  court_max_minutes int not null default 180 check (court_max_minutes between 30 and 720),
  court_slot_minutes int not null default 60 check (court_slot_minutes in (30,60)),
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create type public.club_role as enum ('owner','admin','host','varsity','member','flagged','pending','banned');

create table public.memberships (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.club_role not null default 'member',
  rules_version_accepted int,
  rules_accepted_at timestamptz,
  note text,                           -- staff-only note (e.g. why flagged)
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index memberships_user on public.memberships(user_id);

-- Booking window and guest rules per role, per club.
create table public.club_role_rules (
  club_id uuid not null references public.clubs(id) on delete cascade,
  role public.club_role not null,
  window_hours int not null check (window_hours between 0 and 2160), -- how long before start they may book
  max_guests int not null default 1 check (max_guests between 0 and 10),
  primary key (club_id, role)
);

create table public.house_rules (
  club_id uuid not null references public.clubs(id) on delete cascade,
  version int not null,
  body text not null,
  published_at timestamptz not null default now(),
  primary key (club_id, version)
);

-- ─────────────────────────────────────────────────────────────── courts
create table public.courts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  surface text,
  hourly_rate numeric(10,2) not null default 0 check (hourly_rate >= 0),
  rentable boolean not null default true,
  sort int not null default 0,
  active boolean not null default true,
  unique (club_id, name)
);
create index courts_club on public.courts(club_id);

-- Opening hours for rentals, in the club's local time. Missing weekday = closed.
create table public.club_hours (
  club_id uuid not null references public.clubs(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),   -- 0 = Sunday
  opens time not null,
  closes time not null,                                   -- '00:00' means midnight
  primary key (club_id, weekday)
);

-- Peak / special pricing. court_id null = all courts. First matching rule (highest priority) wins per slot.
create table public.rate_rules (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  court_id uuid references public.courts(id) on delete cascade,
  label text not null,
  weekdays int[] not null default '{0,1,2,3,4,5,6}',
  starts time not null,
  ends time not null,
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  priority int not null default 0
);

-- One row per court per period that is taken. The exclusion constraint makes double-booking
-- impossible, whether the period is an open-play session, a rental or maintenance.
create table public.court_reservations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  court_id uuid not null references public.courts(id) on delete cascade,
  period tstzrange not null check (not isempty(period)),
  source text not null check (source in ('session','rental','block')),
  source_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  exclude using gist (court_id with =, period with &&) where (active)
);
create index court_reservations_lookup on public.court_reservations(club_id, active);
create index court_reservations_source on public.court_reservations(source, source_id);

-- ─────────────────────────────────────────────────────────────── open play sessions
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  fee numeric(10,2) not null check (fee >= 0),
  capacity int not null check (capacity between 1 and 500),
  court_ids uuid[] not null default '{}',
  level text,                           -- e.g. '3.0–3.5', 'Open'
  waitlist_enabled boolean not null default true,
  refund_cutoff_hours int,              -- null = club default
  host_id uuid references public.profiles(id),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  cancel_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index sessions_club_time on public.sessions(club_id, starts_at);

create table public.session_bookings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  guest_names text[] not null default '{}',
  seats int generated always as (1 + coalesce(array_length(guest_names, 1), 0)) stored,
  amount numeric(10,2) not null check (amount >= 0),
  -- pending_payment: seat held while paying · confirmed · waitlist_pending_payment: paying for a waitlist place
  -- waitlisted: paid, waiting for a seat · cancelled · expired: hold lapsed or waitlist never promoted
  status text not null check (status in
    ('pending_payment','confirmed','waitlist_pending_payment','waitlisted','cancelled','expired')),
  hold_expires_at timestamptz,
  paid_amount numeric(10,2) not null default 0,
  source text not null default 'app' check (source in ('app','staff')),
  checked_in_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index session_bookings_session on public.session_bookings(session_id, status);
create index session_bookings_user on public.session_bookings(user_id);
-- one live booking per player per session
create unique index session_bookings_one_live on public.session_bookings(session_id, user_id)
  where status in ('pending_payment','confirmed','waitlist_pending_payment','waitlisted');

-- ─────────────────────────────────────────────────────────────── court rentals
create table public.court_bookings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  court_id uuid not null references public.courts(id),
  user_id uuid not null references public.profiles(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  amount numeric(10,2) not null check (amount >= 0),
  status text not null check (status in ('pending_payment','confirmed','cancelled','expired')),
  hold_expires_at timestamptz,
  paid_amount numeric(10,2) not null default 0,
  source text not null default 'app' check (source in ('app','staff')),
  note text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index court_bookings_club_time on public.court_bookings(club_id, starts_at);
create index court_bookings_user on public.court_bookings(user_id);

-- ─────────────────────────────────────────────────────────────── money
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  user_id uuid not null references public.profiles(id),
  purpose text not null check (purpose in ('session_booking','court_booking')),
  purpose_id uuid not null,
  amount numeric(10,2) not null check (amount > 0),
  method text not null check (method in ('techpay','gcash_receipt','cash')),
  -- pending: waiting on gateway or AI check · review: needs a person · approved · rejected
  status text not null default 'pending' check (status in ('pending','review','approved','rejected')),
  -- TechPay
  gateway_ref text unique,
  gateway_status text,
  gateway_fee numeric(10,2),
  gateway_payload jsonb,
  -- GCash receipt
  proof_path text,                      -- storage path in the private 'receipts' bucket
  reported_reference text,
  receipt_ref_norm text,                -- digits of the verified reference, for duplicate detection
  extracted jsonb,                      -- what the AI read
  ai_verdict text check (ai_verdict in ('approved','flagged','duplicate','error')),
  ai_notes text,
  -- people
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  is_test boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index payments_club on public.payments(club_id, created_at desc);
create index payments_purpose on public.payments(purpose, purpose_id);
create index payments_user on public.payments(user_id, created_at desc);
-- A GCash reference can pay for exactly one thing, across every club on the platform.
create unique index payments_receipt_ref_once on public.payments(receipt_ref_norm)
  where status = 'approved' and receipt_ref_norm is not null;

-- Money the club owes a player. Created automatically wherever a player is owed; every deposit has an exit.
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  user_id uuid not null references public.profiles(id),
  payment_id uuid references public.payments(id),
  purpose text not null,
  purpose_id uuid,
  amount numeric(10,2) not null check (amount > 0),
  reason text not null,
  status text not null default 'owed' check (status in ('owed','paid','waived')),
  settled_by uuid references public.profiles(id),
  settled_at timestamptz,
  settle_note text,
  created_at timestamptz not null default now()
);
create index refunds_club_status on public.refunds(club_id, status);
create index refunds_user on public.refunds(user_id);

-- Who did what. Every staff override writes here.
create table public.audit_log (
  id bigserial primary key,
  club_id uuid references public.clubs(id),
  actor uuid,
  action text not null,
  target_type text,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_club on public.audit_log(club_id, created_at desc);

-- Problems the hourly job found (e.g. a payment with no booking). Staff see these on the dashboard.
create table public.alerts (
  id bigserial primary key,
  club_id uuid references public.clubs(id),
  kind text not null,
  target_type text,
  target_id uuid,
  message text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, target_id)
);

create table public.gateway_webhook_log (
  id bigserial primary key,
  received_at timestamptz not null default now(),
  source_ip text, reference text, amount numeric, status text,
  signature_received text, signature_expected text, signature_ok boolean,
  outcome text, payload jsonb
);

-- ─────────────────────────────────────────────────────────────── helpers
create or replace function public.my_role(p_club uuid) returns public.club_role
language sql stable security definer set search_path = public as $$
  select role from memberships where club_id = p_club and user_id = auth.uid()
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from profiles where id = auth.uid()), false)
$$;

create or replace function public.is_club_admin(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or coalesce(public.my_role(p_club) in ('owner','admin'), false)
$$;

create or replace function public.is_club_staff(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or coalesce(public.my_role(p_club) in ('owner','admin','host'), false)
$$;

create or replace function public.audit(p_club uuid, p_action text, p_type text, p_id uuid, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (club_id, actor, action, target_type, target_id, details)
  values (p_club, auth.uid(), p_action, p_type, p_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public.owe_refund(p_club uuid, p_user uuid, p_payment uuid, p_purpose text,
  p_purpose_id uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if coalesce(p_amount, 0) <= 0 then return null; end if;
  insert into refunds (club_id, user_id, payment_id, purpose, purpose_id, amount, reason)
  values (p_club, p_user, p_payment, p_purpose, p_purpose_id, p_amount, p_reason)
  returning id into rid;
  return rid;
end $$;

create or replace function public.hold_minutes() returns int language sql stable as $$
  select public.cfg('hold_minutes', '15')::int
$$;

-- Seats taken in a session (held + confirmed).
create or replace function public.seats_taken(p_session uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(seats), 0)::int from session_bookings
  where session_id = p_session and status in ('pending_payment','confirmed')
$$;

create or replace function public.session_refund_cutoff(p_session uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select s.starts_at - make_interval(hours => coalesce(s.refund_cutoff_hours, c.refund_cutoff_hours))
  from sessions s join clubs c on c.id = s.club_id where s.id = p_session
$$;
