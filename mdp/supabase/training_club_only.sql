-- Training: the app handles only the club's part (court and ball boy). Players pay the coach
-- directly, outside the app, because the coach doesn't confirm payments in her app (Nov 12, 2026).
-- Switch: app_config training_coach_fee = 'off' (app doesn't track the coach fee) or 'on' (as before).

insert into app_config (key, value) values ('training_coach_fee', 'off') on conflict (key) do update set value = 'off';

-- Coach fee lines are simply not created while the switch is off (training-api still tries).
create or replace function skip_coach_lines() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.component = 'coach' and coalesce((select value from app_config where key = 'training_coach_fee'), 'on') = 'off' then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists a_skip_coach_lines on payment_lines;
create trigger a_skip_coach_lines before insert on payment_lines for each row execute function skip_coach_lines();

-- Coach fees still open on training days from today on: no longer the app's to collect.
update payment_lines pl set status = 'waived',
  ai_notes = coalesce(ai_notes || E'\n', '') || 'Coach fee is now paid to the coach directly, outside the app.'
from booking_participants bp, training_bookings tb, training_blocks b, training_days d
where pl.participant_id = bp.id and bp.booking_id = tb.id and tb.block_id = b.id and b.training_day_id = d.id
  and pl.component = 'coach' and pl.status in ('unpaid', 'rejected', 'proof_uploaded')
  and d.session_date >= (now() at time zone 'Asia/Manila')::date;
