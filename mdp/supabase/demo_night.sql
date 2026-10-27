-- DEMO DATABASE ONLY (dupr-demo branch). Run before a rehearsal or the call with Haresh.
-- Moves the "DUPR Demo" session to today, books all 12 demo players into it (paid from wallet),
-- and clears the court board so the night starts fresh. Games already sent to DUPR are kept.
-- Safe to run again on any day.

with s as (select id from sessions where label = 'DUPR Demo' order by created_at limit 1)
update sessions set session_date = (now() at time zone 'Asia/Manila')::date, courts = 3, max_players = 16,
       time_start = '19:00', time_end = '22:00', is_cancelled = false
where id = (select id from s);

update registrations set session_date = (now() at time zone 'Asia/Manila')::date
where session_uuid = (select id from sessions where label = 'DUPR Demo');

insert into registrations (session_id, session_uuid, session_label, session_date, player_name, user_id, amount, credit_applied, gcash_paid,
  status, ai_check_status, ai_check_notes, booking_type, blocks_slot)
select s.id, s.id, s.label, s.session_date, p.full_name, p.id, 300, 300, 0, 'paid', 'approved', 'Paid from wallet (demo data)', 'solo', false
from sessions s cross join profiles p
where s.label = 'DUPR Demo' and coalesce(trim(p.full_name), '') <> ''
  and not exists (select 1 from registrations r where r.session_uuid = s.id and r.user_id = p.id and r.status in ('paid', 'pending'));

-- Fresh court board: nobody checked in, no partners, no games on court.
delete from dupr_live_games where session_id = (select id from sessions where label = 'DUPR Demo');
update dupr_sheet_players set status = 'out', partner_id = null, queued_at = null, stack = null
where session_id = (select id from sessions where label = 'DUPR Demo');

select s.label, s.session_date, s.courts, count(r.*) as booked
from sessions s left join registrations r on r.session_uuid = s.id and r.status = 'paid'
where s.label = 'DUPR Demo' group by 1, 2, 3;
