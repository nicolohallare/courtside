-- Members screen in the new admin: everyone with their tier and how much they actually play,
-- so promoting a regular from Community to Member is one tap.
create or replace function admin_members() returns table (
  id uuid, full_name text, email text, phone text, tier text, joined date, last_played date,
  games_90d int, games_all int, dupr numeric, wallet numeric, blocked boolean, blocked_note text,
  tier_changed_at timestamptz, is_admin boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.phone, coalesce(p.access_tier, 'community'),
    (p.created_at at time zone 'Asia/Manila')::date,
    g.last_played, coalesce(g.n90, 0)::int, coalesce(g.n, 0)::int,
    p.dupr_doubles, coalesce(cb.balance, 0),
    p.booking_blocked_at is not null, p.booking_blocked_note, p.tier_changed_at,
    coalesce(p.is_admin, false) or coalesce(p.super_admin, false)
  from profiles p
  left join credit_balances cb on cb.user_id = p.id
  left join lateral (
    select max(s.session_date) last_played, count(distinct s.id) n,
      count(distinct s.id) filter (where s.session_date > current_date - 90) n90
    from registrations r join sessions s on s.id = r.session_uuid
    where r.user_id = p.id and r.status = 'paid' and not coalesce(s.is_cancelled, false)
      and s.session_date <= (now() at time zone 'Asia/Manila')::date
  ) g on true
  where is_club_admin()
  order by p.full_name;
$$;
revoke all on function admin_members() from public, anon;
grant execute on function admin_members() to authenticated;
