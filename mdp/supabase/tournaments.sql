-- Tournament registration for the new app. RUN ON THE DEMO DATABASE ONLY (dupr-demo branch) for now.
-- Rules (from MDP's tournament director):
--   * DUPR is required. Both players connect DUPR in the app, and DUPR's own entitlement
--     for tournaments is checked: BASIC_L1 for regular divisions, PREMIUM_L1 where a division asks for it.
--   * A team is placed by the higher partner's doubles rating. Above a division's limit: not allowed.
--     Below its floor: allowed as "playing up", flagged for the organizer.
--   * A second division costs less (second_price), and is flagged so the schedule can work around it.
--   * Pay from the MDP wallet (top up with TechPay if short). Cancelling before the event refunds to the wallet.
--   * Organizers: MDP admins whose DUPR account is DIRECTOR or ORGANIZER of the MDP club on DUPR.

create table if not exists tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  division text not null,
  player1 uuid not null references profiles(id),
  player2 uuid not null references profiles(id),
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'declined', 'cancelled')),
  p1_rating numeric, p2_rating numeric, team_rating numeric,
  p1_dupr text, p2_dupr text, p1_level text, p2_level text,
  playing_up boolean not null default false,
  second_event boolean not null default false,
  price numeric not null,
  paid_at timestamptz, cancelled_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  check (player1 <> player2)
);
create unique index if not exists tournament_entries_live_uq on tournament_entries (tournament_id, division, least(player1, player2), greatest(player1, player2))
  where status in ('unpaid', 'paid');
alter table tournament_entries enable row level security;
revoke all on tournament_entries from anon, authenticated;

-- A tournament payment from the wallet is not a session booking: keep the old trigger off it.
create or replace function public.mark_paid_on_wallet_debit()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
DECLARE reg record;
BEGIN
  IF NEW.amount >= 0 THEN RETURN NULL; END IF;
  IF NEW.reason LIKE 'Tournament:%' THEN RETURN NULL; END IF;
  BEGIN
    SELECT r.id, r.amount INTO reg
    FROM registrations r
    WHERE r.user_id = NEW.user_id
      AND r.status = 'pending'
      AND r.proof_url IS NULL
      AND abs(EXTRACT(EPOCH FROM (NEW.created_at - r.created_at))) < 120
    ORDER BY abs(EXTRACT(EPOCH FROM (NEW.created_at - r.created_at)))
    LIMIT 1;
    IF reg.id IS NULL THEN RETURN NULL; END IF;
    IF abs(NEW.amount) + 0.005 < COALESCE(reg.amount, 0) THEN RETURN NULL; END IF;
    UPDATE registrations SET status = 'paid',
      admin_note = COALESCE(admin_note || ' | ','') || 'Paid ₱' || abs(NEW.amount) || ' from wallet.'
    WHERE id = reg.id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END $function$;

-- A player's DUPR standing for tournaments: connected?, rating, entitlement level.
create or replace function _t_dupr(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'connected', l.dupr_id is not null,
    'dupr_id', l.dupr_id,
    'rating', coalesce(l.rating_doubles, p.dupr_doubles),
    'level', case when l.entitlements::text like '%PREMIUM_L1%' then 'PREMIUM_L1'
                  when l.entitlements::text like '%BASIC_L1%' then 'BASIC_L1' end)
  from profiles p
  left join lateral (select * from dupr_links x where x.user_id = p.id order by x.updated_at desc limit 1) l on true
  where p.id = p_user;
$$;

create or replace function _t_organizer() returns boolean
language sql stable security definer set search_path = public as $$
  select is_club_admin() and exists (
    select 1 from dupr_links l, jsonb_array_elements(coalesce(l.clubs->'membership', '[]'::jsonb)) m
    where l.user_id = auth.uid()
      and (m->>'clubId')::bigint = (select value::bigint from app_config where key = 'dupr_club_id_' || coalesce((select value from app_config where key = 'dupr_env'), 'uat'))
      and m->>'role' in ('DIRECTOR', 'ORGANIZER'));
$$;

-- The tournament with live counts per division, my entries, and whether I organize it.
create or replace function tournament_view(p_tournament uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t tournaments; me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into t from tournaments where (p_tournament is null and active and coalesce(ends_on, starts_on) >= (now() at time zone 'Asia/Manila')::date)
     or id = p_tournament order by starts_on limit 1;
  if t.id is null then return null; end if;
  return to_jsonb(t) || jsonb_build_object(
    'divisions', (select coalesce(jsonb_agg(d.value || jsonb_build_object('taken',
        (select count(*) from tournament_entries e where e.tournament_id = t.id and e.division = d.value->>'name' and e.status in ('unpaid', 'paid')))), '[]'::jsonb)
      from jsonb_array_elements(coalesce(t.divisions, '[]'::jsonb)) d),
    'me', _t_dupr(me),
    'organizer', _t_organizer(),
    'open', t.starts_on > (now() at time zone 'Asia/Manila')::date,
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'division', e.division, 'status', e.status, 'price', e.price,
        'team_rating', e.team_rating, 'playing_up', e.playing_up, 'second_event', e.second_event, 'i_registered', e.created_by = me,
        'partner', (select full_name from profiles where id = case when e.player1 = me then e.player2 else e.player1 end))
        order by e.created_at), '[]'::jsonb)
      from tournament_entries e where e.tournament_id = t.id and me in (e.player1, e.player2) and e.status in ('unpaid', 'paid')));
end $$;

-- Members who can be picked as a partner (with their DUPR standing, so the check shows before registering).
create or replace function tournament_partners(p_q text default '') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) || _t_dupr(p.id) order by p.full_name), '[]'::jsonb)
  from (select id, full_name from profiles where id <> auth.uid() and coalesce(trim(full_name), '') <> ''
          and (p_q = '' or full_name ilike '%' || p_q || '%') order by full_name limit 30) p;
$$;

-- Register a team. Checks DUPR for both players, places by the higher rating, prices a second division lower.
create or replace function tournament_register(p_tournament uuid, p_division text, p_partner uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t tournaments; d jsonb; a jsonb; b jsonb; team numeric; lo numeric; hi numeric;
  need text; second boolean; price numeric; taken int; new_id uuid; up boolean := false; nm text; pn text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_partner is null or p_partner = me then raise exception 'Pick your partner'; end if;
  select * into t from tournaments where id = p_tournament and active;
  if t.id is null then raise exception 'This tournament isn''t open'; end if;
  if t.starts_on <= (now() at time zone 'Asia/Manila')::date then raise exception 'Registration has closed'; end if;
  select x.value into d from jsonb_array_elements(coalesce(t.divisions, '[]'::jsonb)) x where x.value->>'name' = p_division;
  if d is null then raise exception 'Pick a division'; end if;
  select full_name into nm from profiles where id = me;
  select full_name into pn from profiles where id = p_partner;

  -- DUPR checks, both players.
  a := _t_dupr(me); b := _t_dupr(p_partner);
  if not coalesce((a->>'connected')::boolean, false) then raise exception 'Connect your DUPR account first (Me, then Connect DUPR)'; end if;
  if not coalesce((b->>'connected')::boolean, false) then raise exception '% hasn''t connected DUPR yet. Ask them to open the app and connect it in Me.', pn; end if;
  need := coalesce(d->>'requires', 'BASIC_L1');
  if a->>'level' is null or (need = 'PREMIUM_L1' and a->>'level' <> 'PREMIUM_L1') then
    raise exception 'DUPR says your account can''t enter this division. It needs DUPR %.', case need when 'PREMIUM_L1' then 'Premium' else 'Basic (a verified account)' end; end if;
  if b->>'level' is null or (need = 'PREMIUM_L1' and b->>'level' <> 'PREMIUM_L1') then
    raise exception 'DUPR says %''s account can''t enter this division. It needs DUPR %.', pn, case need when 'PREMIUM_L1' then 'Premium' else 'Basic (a verified account)' end; end if;

  -- Men's, women's and mixed divisions (checked when both genders are on the profiles).
  if d->>'gender' in ('M', 'F', 'X') then
    declare g1 text := (select upper(left(gender, 1)) from profiles where id = me);
            g2 text := (select upper(left(gender, 1)) from profiles where id = p_partner);
    begin
      if g1 in ('M','F') and g2 in ('M','F') then
        if d->>'gender' = 'X' and g1 = g2 then raise exception '% is for mixed pairs (one man, one woman)', p_division; end if;
        if d->>'gender' in ('M','F') and (g1 <> d->>'gender' or g2 <> d->>'gender') then
          raise exception '% is a % division', p_division, case d->>'gender' when 'M' then 'men''s' else 'women''s' end; end if;
      end if;
    end;
  end if;

  -- Placement: the higher partner's doubles rating.
  team := greatest(coalesce((a->>'rating')::numeric, 0), coalesce((b->>'rating')::numeric, 0));
  if team = 0 then raise exception 'One of you has no DUPR doubles rating yet, so you can''t be placed. Play a rated game first.'; end if;
  lo := nullif(d->>'min', '')::numeric; hi := nullif(d->>'max', '')::numeric;
  if hi is not null and team > hi then raise exception 'Your team rating is % (the higher of you two). This division is for % and below.', to_char(team, 'FM0.00'), to_char(hi, 'FM0.00'); end if;
  if lo is not null and team < lo then up := true; end if;

  if exists (select 1 from tournament_entries e where e.tournament_id = t.id and e.division = p_division and e.status in ('unpaid','paid')
             and (me in (e.player1, e.player2) or p_partner in (e.player1, e.player2))) then
    raise exception 'One of you is already registered in %', p_division; end if;
  select count(*) into taken from tournament_entries e where e.tournament_id = t.id and e.division = p_division and e.status in ('unpaid','paid');
  if nullif(d->>'spots', '')::int is not null and taken >= (d->>'spots')::int then raise exception '% is full', p_division; end if;

  second := exists (select 1 from tournament_entries e where e.tournament_id = t.id and e.status in ('unpaid','paid') and me in (e.player1, e.player2));
  price := case when second and d ? 'second_price' then (d->>'second_price')::numeric else (d->>'price')::numeric end;

  insert into tournament_entries (tournament_id, division, player1, player2, p1_rating, p2_rating, team_rating, p1_dupr, p2_dupr, p1_level, p2_level, playing_up, second_event, price)
  values (t.id, p_division, me, p_partner, (a->>'rating')::numeric, (b->>'rating')::numeric, team, a->>'dupr_id', b->>'dupr_id', a->>'level', b->>'level', up, second, price)
  returning tournament_entries.id into new_id;
  perform _push(p_partner, t.name, format('%s registered you as their partner in %s.', nm, p_division), '/events/', 'tourney');
  return jsonb_build_object('ok', true, 'id', new_id, 'price', price, 'team_rating', team, 'playing_up', up, 'second_event', second);
end $$;

-- Pay an entry from the wallet.
create or replace function tournament_pay(p_entry uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e tournament_entries; t tournaments; bal numeric; me uuid := auth.uid();
begin
  select * into e from tournament_entries where id = p_entry for update;
  if e.id is null or me not in (e.player1, e.player2) then raise exception 'Entry not found'; end if;
  if e.status = 'paid' then return jsonb_build_object('ok', true, 'already', true); end if;
  if e.status <> 'unpaid' then raise exception 'This entry was cancelled'; end if;
  select * into t from tournaments where id = e.tournament_id;
  select coalesce(sum(amount), 0) into bal from credits where user_id = me;
  if bal + 0.005 < e.price then raise exception 'Your wallet has ₱% and this entry is ₱%. Top up first.', to_char(bal, 'FM999,990'), to_char(e.price, 'FM999,990'); end if;
  insert into credits (user_id, amount, reason, created_by) values (me, -e.price, format('Tournament: %s, %s', t.name, e.division), me);
  update tournament_entries set status = 'paid', paid_at = now() where id = e.id;
  perform _push(case when e.player1 = me then e.player2 else e.player1 end, t.name, format('Your %s entry is paid. See you on court!', e.division), '/events/', 'tourney');
  return jsonb_build_object('ok', true);
end $$;

-- Withdraw (either partner). A paid entry goes back to the wallet of whoever paid it.
create or replace function tournament_withdraw(p_entry uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e tournament_entries; t tournaments; me uuid := auth.uid(); payer uuid;
begin
  select * into e from tournament_entries where id = p_entry for update;
  if e.id is null or me not in (e.player1, e.player2) then raise exception 'Entry not found'; end if;
  if e.status not in ('unpaid', 'paid') then return jsonb_build_object('ok', true); end if;
  select * into t from tournaments where id = e.tournament_id;
  if t.starts_on <= (now() at time zone 'Asia/Manila')::date then raise exception 'The tournament has started. Contact the tournament director.'; end if;
  if e.status = 'paid' then
    select c.user_id into payer from credits c where c.reason = format('Tournament: %s, %s', t.name, e.division)
      and c.user_id in (e.player1, e.player2) and c.amount = -e.price order by c.created_at desc limit 1;
    insert into credits (user_id, amount, reason, created_by) values (coalesce(payer, e.created_by), e.price, format('Refund: %s, %s', t.name, e.division), me);
  end if;
  update tournament_entries set status = 'cancelled', cancelled_at = now() where id = e.id;
  perform _push(case when e.player1 = me then e.player2 else e.player1 end, t.name, format('Your %s entry was withdrawn.', e.division), '/events/', 'tourney');
  return jsonb_build_object('ok', true, 'refunded', e.status = 'paid');
end $$;

-- Organizer view: every team by division with ratings and DUPR checks.
create or replace function tournament_roster(p_tournament uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not _t_organizer() then raise exception 'Only MDP club directors and organizers on DUPR can see the full list'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'division', e.division, 'status', e.status, 'price', e.price,
      'team_rating', e.team_rating, 'playing_up', e.playing_up, 'second_event', e.second_event, 'created_at', e.created_at,
      'p1', jsonb_build_object('name', a.full_name, 'rating', e.p1_rating, 'dupr', e.p1_dupr, 'level', e.p1_level),
      'p2', jsonb_build_object('name', b.full_name, 'rating', e.p2_rating, 'dupr', e.p2_dupr, 'level', e.p2_level))
      order by e.division, e.team_rating desc), '[]'::jsonb)
    from tournament_entries e join profiles a on a.id = e.player1 join profiles b on b.id = e.player2
    where e.tournament_id = p_tournament and e.status in ('unpaid', 'paid'));
end $$;

revoke all on function _t_dupr(uuid), _t_organizer() from public, anon, authenticated;
revoke all on function tournament_view(uuid), tournament_partners(text), tournament_register(uuid, text, uuid), tournament_pay(uuid), tournament_withdraw(uuid), tournament_roster(uuid) from public, anon;
grant execute on function tournament_view(uuid), tournament_partners(text), tournament_register(uuid, text, uuid), tournament_pay(uuid), tournament_withdraw(uuid), tournament_roster(uuid) to authenticated;

-- Demo tournament (only if there isn't one yet).
insert into tournaments (name, tagline, starts_on, ends_on, venue, city, director, blurb, divisions, active)
select 'MDP Season 4', 'Company Cup', date '2026-12-05', date '2026-12-06', 'The Zone', 'Makati City', 'Pardner Azarcon',
  'Company teams, booths and loot bags. Every match is DUPR rated. Register with your partner; your DUPR is checked automatically.',
  '[{"name":"Open 4.0+","min":4.0,"price":3200,"second_price":2400,"spots":24,"requires":"PREMIUM_L1"},
    {"name":"Intermediate 3.5","min":3.0,"max":3.5,"price":2800,"second_price":2100,"spots":32},
    {"name":"Advanced 3.75","min":3.5,"max":3.75,"price":2800,"second_price":2100,"spots":24},
    {"name":"Novice 3.0","max":3.0,"price":2400,"second_price":1800,"spots":32},
    {"name":"Mixed 3.5","max":3.5,"gender":"X","price":2800,"second_price":2100,"spots":24}]'::jsonb,
  true
where not exists (select 1 from tournaments where active);

select name, starts_on, jsonb_array_length(divisions) divisions from tournaments where active;

-- Demo players' genders, so men's / women's / mixed divisions are checked in the demo.
update profiles p set gender = g.g from (values ('Nicolo Hallare','M'),('Izza Hallare','F'),('Meg Lee','F'),('Rorie Manzano','F'),('Juan Dela Cruz','M'),('Mia Santos','F'),
  ('Carlo Reyes','M'),('Ben Uy','M'),('Ana Reyes','F'),('Paolo Santos','M'),('Rina Cruz','F'),('Kris Lim','M')) g(n, g)
where p.full_name = g.n and p.gender is null;
