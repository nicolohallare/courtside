-- Admin in the new app. Run on the demo first, then on live when the new admin goes out.
--
-- Overpayments: the receipt check already reads the amount sent (registrations.extracted_amount).
-- When a member sent more than they owed, the excess belongs in their wallet. Until now an admin
-- did that by hand (Carlos Cabigao, Nov 10). These list what is still owed and credit it once.

-- An admin can mark one as "not an overpayment" (e.g. the extra paid for a friend outside the app).
create table if not exists overpay_dismissed (reg_id uuid primary key, by_user uuid, note text, at timestamptz default now());
alter table overpay_dismissed enable row level security;

create or replace function admin_overpaid() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'reg_id', r.id, 'user_id', r.user_id, 'player_name', r.player_name, 'session_label', r.session_label,
    'session_date', r.session_date, 'owed', greatest(0, r.amount - coalesce(r.credit_applied, 0)),
    'sent', r.extracted_amount, 'excess', r.extracted_amount - greatest(0, r.amount - coalesce(r.credit_applied, 0)),
    'gcash_ref', r.gcash_ref, 'proof_url', r.proof_url
  ) order by r.created_at desc), '[]'::jsonb)
  from registrations r
  where is_club_admin()
    and r.status = 'paid' and r.user_id is not null and r.paid_by_reg_id is null
    and r.created_at > now() - interval '45 days'
    and r.extracted_amount is not null
    and r.extracted_amount - greatest(0, r.amount - coalesce(r.credit_applied, 0)) >= 1
    -- the payment covers only this booking (a payer's receipt can cover friends' slots too)
    and not exists (select 1 from registrations k where k.paid_by_reg_id = r.id and k.status <> 'cancelled')
    and not exists (select 1 from credits c where c.source_reg_id = r.id and c.amount > 0 and c.reason ilike 'Overpayment%')
    and not exists (select 1 from credits c where c.user_id = r.user_id and c.amount > 0 and r.gcash_ref is not null and c.reason ilike '%' || r.gcash_ref || '%')
    and not exists (select 1 from overpay_dismissed d where d.reg_id = r.id);
$$;

create or replace function admin_dismiss_overpay(p_reg uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_club_admin() then raise exception 'Admins only'; end if;
  insert into overpay_dismissed (reg_id, by_user, note) values (p_reg, auth.uid(), nullif(trim(p_note), ''))
  on conflict (reg_id) do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_credit_overpay(p_reg uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r registrations; owed numeric; extra numeric;
begin
  if not is_club_admin() then raise exception 'Admins only'; end if;
  select * into r from registrations where id = p_reg for update;
  if r.id is null then raise exception 'Booking not found'; end if;
  if r.status <> 'paid' then raise exception 'Approve the payment first'; end if;
  owed := greatest(0, r.amount - coalesce(r.credit_applied, 0));
  extra := coalesce(r.extracted_amount, 0) - owed;
  if extra < 1 then raise exception 'Nothing extra was paid'; end if;
  if exists (select 1 from credits c where c.source_reg_id = r.id and c.amount > 0 and c.reason ilike 'Overpayment%') then
    raise exception 'Already added to % wallet', r.player_name;
  end if;
  insert into credits (user_id, amount, reason, session_id, source_reg_id, created_by)
  values (r.user_id, extra, 'Overpayment: sent ₱' || r.extracted_amount || ' for ' || r.session_label || ' (₱' || owed || ' due)' ||
          coalesce(', GCash ref ' || r.gcash_ref, ''), r.session_uuid, r.id, auth.uid());
  return jsonb_build_object('ok', true, 'amount', extra,
    'balance', (select balance from credit_balances where user_id = r.user_id));
end $$;

revoke all on function admin_overpaid(), admin_credit_overpay(uuid), admin_dismiss_overpay(uuid, text) from public, anon;
grant execute on function admin_overpaid(), admin_credit_overpay(uuid), admin_dismiss_overpay(uuid, text) to authenticated;
