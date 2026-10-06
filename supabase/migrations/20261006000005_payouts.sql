-- Courtside payouts: the platform collects through its own TechPay account and pays each club its share.
--
-- Why: most clubs (Viber groups, village and alumni clubs) have no DTI/SEC papers or business bank
-- account, so they cannot be TechPay merchants themselves. The platform collects, keeps a ledger of what
-- each club is owed, and pays out on a schedule. Every peso in the ledger points at the payment, refund
-- or payout that caused it, so a club statement always adds up.
--
-- Rules:
--   · An approved TechPay payment at a 'platform' club credits the club (once, even if re-approved).
--   · A refund on a TechPay-paid booking is paid by the platform to the player and debited from the club.
--     Club staff may waive it (credit returns), but only the platform marks it paid.
--   · Collections wait `payout_hold_days` before they can be paid out (cover for chargebacks).
--   · A payout run bundles everything available per club. A negative balance carries forward.
--   · A payout marked failed releases its lines for the next run.

-- ─────────────────────────────────────────────────────────────── settings
insert into public.app_config(key, value) values
  ('payout_hold_days', '2'),
  ('payout_min_amount', '100')
on conflict (key) do nothing;

alter table public.clubs
  add column settlement_mode text not null default 'platform' check (settlement_mode in ('platform','direct'));
comment on column public.clubs.settlement_mode is
  'platform: paid into the platform TechPay account and paid out to the club · direct: settled to the club''s own TechPay sub-merchant';

alter table public.refunds
  add column paid_by text not null default 'club' check (paid_by in ('club','platform'));

-- ─────────────────────────────────────────────────────────────── tables
create table public.payout_accounts (
  club_id uuid primary key references public.clubs(id),   -- no cascade: a club with payout history is never deleted
  method text not null check (method in ('bank','gcash','maya')),
  bank_name text,
  account_name text not null,
  account_number text not null,
  holder_type text not null check (holder_type in ('club','organizer')),
  organizer_user_id uuid references public.profiles(id),  -- when paid to a person, who it is
  verified_at timestamptz,                                -- platform checked the name and ID
  verified_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  check (method <> 'bank' or bank_name is not null),
  check (holder_type <> 'organizer' or organizer_user_id is not null)
);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  account jsonb not null,               -- snapshot of the payout account at run time
  reference text,                       -- bank / InstaPay / GCash reference once sent
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_by uuid,
  sent_at timestamptz
);
create index payouts_club on public.payouts(club_id, created_at desc);
create index payouts_status on public.payouts(status);

create table public.club_ledger (
  id bigserial primary key,
  club_id uuid not null references public.clubs(id),
  kind text not null check (kind in ('collection','reversal','refund','refund_waived','adjustment')),
  amount numeric(12,2) not null check (amount <> 0),   -- + owed to the club, − taken from it
  payment_id uuid references public.payments(id),
  refund_id uuid references public.refunds(id),
  payout_id uuid references public.payouts(id),
  available_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);
create index club_ledger_open on public.club_ledger(club_id) where payout_id is null;
create index club_ledger_payout on public.club_ledger(payout_id);
create unique index club_ledger_collection_once on public.club_ledger(payment_id) where kind = 'collection';
create unique index club_ledger_reversal_once on public.club_ledger(payment_id) where kind = 'reversal';
create unique index club_ledger_refund_once on public.club_ledger(refund_id) where kind = 'refund';
create unique index club_ledger_waive_once on public.club_ledger(refund_id) where kind = 'refund_waived';

-- ─────────────────────────────────────────────────────────────── ledger triggers
create or replace function public.payout_ledger_on_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare mode text;
begin
  if new.method <> 'techpay' or new.is_test then return new; end if;
  select settlement_mode into mode from clubs where id = new.club_id;
  if mode <> 'platform' then return new; end if;

  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    insert into club_ledger (club_id, kind, amount, payment_id, available_at, note)
    values (new.club_id, 'collection', new.amount, new.id,
            coalesce(new.paid_at, now()) + make_interval(days => cfg('payout_hold_days', '2')::int),
            'TechPay ' || coalesce(new.gateway_ref, ''))
    on conflict do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'approved' and new.status <> 'approved' then
    insert into club_ledger (club_id, kind, amount, payment_id, note)
    values (new.club_id, 'reversal', -new.amount, new.id, 'Payment reversed: ' || new.status)
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger payments_payout_ledger after insert or update of status on public.payments
  for each row execute function public.payout_ledger_on_payment();

-- Who pays a refund: the platform, when the money for that booking came in through the platform's TechPay.
create or replace function public.payout_refund_payer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from clubs c where c.id = new.club_id and c.settlement_mode = 'platform')
     and exists (select 1 from payments p
                 where p.status = 'approved' and p.method = 'techpay' and not p.is_test
                   and ((new.payment_id is not null and p.id = new.payment_id)
                        or (new.payment_id is null and p.purpose = new.purpose and p.purpose_id = new.purpose_id))) then
    new.paid_by := 'platform';
  end if;
  return new;
end $$;

create trigger refunds_payer before insert on public.refunds
  for each row execute function public.payout_refund_payer();

create or replace function public.payout_ledger_on_refund() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.paid_by <> 'platform' then return new; end if;
  if tg_op = 'INSERT' then
    insert into club_ledger (club_id, kind, amount, refund_id, note)
    values (new.club_id, 'refund', -new.amount, new.id, new.reason)
    on conflict do nothing;
  elsif old.status = 'owed' and new.status = 'waived' then
    insert into club_ledger (club_id, kind, amount, refund_id, note)
    values (new.club_id, 'refund_waived', new.amount, new.id, 'Refund waived: ' || coalesce(new.settle_note, ''))
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger refunds_payout_ledger after insert or update of status on public.refunds
  for each row execute function public.payout_ledger_on_refund();

-- Only the platform marks a platform-paid refund as paid: the club never has that money.
create or replace function public.payout_guard_refund() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.paid_by = 'platform' and new.status = 'paid' and old.status <> 'paid'
     and auth.uid() is not null and not is_platform_admin() then
    raise exception 'Match Day Pickle sends this refund, because the payment came in through TechPay. Waive it only if the player agreed.';
  end if;
  return new;
end $$;

create trigger refunds_guard before update of status on public.refunds
  for each row execute function public.payout_guard_refund();

-- ─────────────────────────────────────────────────────────────── club functions
create or replace function public.set_payout_account(p_club uuid, p_method text, p_bank_name text,
  p_account_name text, p_account_number text, p_holder_type text) returns void
language plpgsql security definer set search_path = public as $$
declare digits text := regexp_replace(coalesce(p_account_number, ''), '\D', '', 'g');
begin
  if not is_club_admin(p_club) then raise exception 'Only the club owner or an admin can change where payouts go'; end if;
  if p_method not in ('bank','gcash','maya') then raise exception 'Choose bank, GCash or Maya'; end if;
  if length(trim(coalesce(p_account_name,''))) < 3 then raise exception 'Enter the account name exactly as the bank or wallet shows it'; end if;
  if length(digits) < 10 then raise exception 'Enter the full account or mobile number'; end if;
  if p_method = 'bank' and length(trim(coalesce(p_bank_name,''))) < 2 then raise exception 'Enter the bank'; end if;
  if p_holder_type not in ('club','organizer') then raise exception 'Say whose account this is'; end if;

  insert into payout_accounts (club_id, method, bank_name, account_name, account_number, holder_type,
    organizer_user_id, verified_at, verified_by, updated_at)
  values (p_club, p_method, nullif(trim(p_bank_name), ''), trim(p_account_name), digits, p_holder_type,
    case when p_holder_type = 'organizer' then auth.uid() end, null, null, now())
  on conflict (club_id) do update set method = excluded.method, bank_name = excluded.bank_name,
    account_name = excluded.account_name, account_number = excluded.account_number,
    holder_type = excluded.holder_type, organizer_user_id = excluded.organizer_user_id,
    verified_at = null, verified_by = null, updated_at = now();
  -- a changed account must be checked again before any money goes to it
  perform audit(p_club, 'payout_account.set', 'club', p_club,
    jsonb_build_object('method', p_method, 'name', p_account_name, 'last4', right(digits, 4), 'holder', p_holder_type));
end $$;

-- Balance and recent lines for one club. Account numbers are shown masked.
create or replace function public.club_payout_summary(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare acct record; res jsonb;
begin
  if not is_club_staff(p_club) then raise exception 'Not allowed'; end if;
  select * into acct from payout_accounts where club_id = p_club;
  select jsonb_build_object(
    'settlement_mode', (select settlement_mode from clubs where id = p_club),
    'available', coalesce((select sum(amount) from club_ledger where club_id = p_club and payout_id is null and available_at <= now()), 0),
    'on_hold', coalesce((select sum(amount) from club_ledger where club_id = p_club and payout_id is null and available_at > now()), 0),
    'next_available_at', (select min(available_at) from club_ledger where club_id = p_club and payout_id is null and available_at > now()),
    'paid_out', coalesce((select sum(amount) from payouts where club_id = p_club and status = 'sent'), 0),
    'account', case when acct.club_id is null then null else jsonb_build_object(
        'method', acct.method, 'bank_name', acct.bank_name, 'account_name', acct.account_name,
        'last4', right(acct.account_number, 4), 'holder_type', acct.holder_type,
        'verified', acct.verified_at is not null) end,
    'payouts', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select id, amount, status, reference, created_at, sent_at from payouts
        where club_id = p_club order by created_at desc limit 20) x), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(y order by y.created_at desc) from (
        select l.id, l.kind, l.amount, l.note, l.created_at, l.available_at, l.payout_id,
               coalesce(pr.full_name, rp.full_name) as player
        from club_ledger l
        left join payments p on p.id = l.payment_id
        left join profiles pr on pr.id = p.user_id
        left join refunds r on r.id = l.refund_id
        left join profiles rp on rp.id = r.user_id
        where l.club_id = p_club order by l.created_at desc limit 100) y), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- ─────────────────────────────────────────────────────────────── platform functions
create or replace function public.verify_payout_account(p_club uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Only the platform team verifies payout accounts'; end if;
  if length(trim(coalesce(p_note,''))) < 3 then raise exception 'Say how you checked it (e.g. ID seen, ₱1 test sent)'; end if;
  update payout_accounts set verified_at = now(), verified_by = auth.uid() where club_id = p_club;
  if not found then raise exception 'This club has no payout account yet'; end if;
  perform audit(p_club, 'payout_account.verify', 'club', p_club, jsonb_build_object('note', p_note));
end $$;

-- Bundle everything available into one payout per club. Clubs without a verified account, below the
-- minimum, or with a negative balance are skipped and reported.
create or replace function public.run_payouts(p_cutoff timestamptz default now())
returns table (club_id uuid, club_name text, amount numeric, payout_id uuid, skipped text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare c record; total numeric; acct record; pid uuid; minimum numeric := cfg('payout_min_amount', '100')::numeric;
begin
  if auth.uid() is not null and not is_platform_admin() then raise exception 'Only the platform team runs payouts'; end if;
  for c in select cl.id, cl.name from clubs cl where cl.settlement_mode = 'platform' order by cl.name loop
    perform pg_advisory_xact_lock(hashtext('payout:' || c.id::text));
    select coalesce(sum(l.amount), 0) into total from club_ledger l
      where l.club_id = c.id and l.payout_id is null and l.available_at <= p_cutoff;
    if total = 0 then continue; end if;
    select * into acct from payout_accounts a where a.club_id = c.id;
    club_id := c.id; club_name := c.name; amount := total; payout_id := null; skipped := null;
    if total < 0 then skipped := 'Owes more in refunds than it collected; carried forward';
    elsif total < minimum then skipped := 'Below the ₱' || minimum || ' minimum; carried forward';
    elsif acct.club_id is null then skipped := 'No payout account';
    elsif acct.verified_at is null then skipped := 'Payout account not verified';
    else
      insert into payouts (club_id, amount, account, created_by)
      values (c.id, total, jsonb_build_object('method', acct.method, 'bank_name', acct.bank_name,
                'account_name', acct.account_name, 'account_number', acct.account_number, 'holder_type', acct.holder_type),
              auth.uid())
      returning id into pid;
      update club_ledger l set payout_id = pid
        where l.club_id = c.id and l.payout_id is null and l.available_at <= p_cutoff;
      payout_id := pid;
      perform audit(c.id, 'payout.create', 'payout', pid, jsonb_build_object('amount', total));
    end if;
    return next;
  end loop;
end $$;

create or replace function public.mark_payout(p_payout uuid, p_status text, p_reference text) returns void
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not is_platform_admin() then raise exception 'Only the platform team marks payouts'; end if;
  select * into p from payouts where id = p_payout for update;
  if p.id is null then raise exception 'No such payout'; end if;
  if p.status <> 'pending' then raise exception 'This payout is already %', p.status; end if;
  if p_status = 'sent' then
    if length(trim(coalesce(p_reference,''))) < 4 then raise exception 'Enter the transfer reference'; end if;
    update payouts set status = 'sent', reference = trim(p_reference), sent_by = auth.uid(), sent_at = now() where id = p_payout;
  elsif p_status = 'failed' then
    if length(trim(coalesce(p_reference,''))) < 3 then raise exception 'Say why it failed'; end if;
    update payouts set status = 'failed', note = trim(p_reference) where id = p_payout;
    update club_ledger set payout_id = null where payout_id = p_payout;   -- back into the next run
  else
    raise exception 'Choose sent or failed';
  end if;
  perform audit(p.club_id, 'payout.' || p_status, 'payout', p_payout,
    jsonb_build_object('amount', p.amount, 'reference', p_reference));
end $$;

-- What the platform has to do: payouts to send and refunds it owes players.
create or replace function public.platform_money() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'pending_payouts', coalesce((select jsonb_agg(x order by x.created_at) from (
        select p.id, p.club_id, c.name as club_name, p.amount, p.account, p.created_at
        from payouts p join clubs c on c.id = p.club_id where p.status = 'pending') x), '[]'::jsonb),
    'refunds_owed', coalesce((select jsonb_agg(y order by y.created_at) from (
        select r.id, r.club_id, c.name as club_name, r.amount, r.reason, r.created_at, pr.full_name, pr.phone
        from refunds r join clubs c on c.id = r.club_id join profiles pr on pr.id = r.user_id
        where r.paid_by = 'platform' and r.status = 'owed') y), '[]'::jsonb),
    'held_for_clubs', coalesce((select sum(amount) from club_ledger where payout_id is null), 0)
      + coalesce((select sum(amount) from payouts where status = 'pending'), 0),
    'unverified_accounts', coalesce((select jsonb_agg(z) from (
        select a.club_id, c.name as club_name, a.method, a.bank_name, a.account_name,
               right(a.account_number, 4) as last4, a.holder_type, pr.full_name as organizer
        from payout_accounts a join clubs c on c.id = a.club_id
        left join profiles pr on pr.id = a.organizer_user_id
        where a.verified_at is null) z), '[]'::jsonb)
  );
end $$;

-- ─────────────────────────────────────────────────────────────── access
alter table public.payout_accounts enable row level security;
alter table public.payouts enable row level security;
alter table public.club_ledger enable row level security;
create policy payout_accounts_admin on public.payout_accounts for select to authenticated using (is_club_admin(club_id));
create policy payouts_staff on public.payouts for select to authenticated using (is_club_staff(club_id));
create policy club_ledger_staff on public.club_ledger for select to authenticated using (is_club_staff(club_id));

revoke all on public.payout_accounts, public.payouts, public.club_ledger from anon, authenticated;
grant select on public.payouts, public.club_ledger to authenticated;
grant select on public.payout_accounts to authenticated;
grant all on public.payout_accounts, public.payouts, public.club_ledger to service_role;
grant usage, select on sequence public.club_ledger_id_seq to service_role;

revoke execute on function
  public.payout_ledger_on_payment(), public.payout_refund_payer(), public.payout_ledger_on_refund(),
  public.payout_guard_refund(),
  public.set_payout_account(uuid, text, text, text, text, text),
  public.club_payout_summary(uuid),
  public.verify_payout_account(uuid, text),
  public.run_payouts(timestamptz),
  public.mark_payout(uuid, text, text),
  public.platform_money()
from public, anon, authenticated;

grant execute on function
  public.set_payout_account(uuid, text, text, text, text, text),
  public.club_payout_summary(uuid),
  public.verify_payout_account(uuid, text),
  public.run_payouts(timestamptz),
  public.mark_payout(uuid, text, text),
  public.platform_money()
to authenticated;
grant execute on function public.run_payouts(timestamptz) to service_role;
