-- DEMO DATABASE ONLY (dupr-demo). Sample week for trying the new Admin:
-- this week's sessions, receipts to check (one flagged), one overpayment and one draft.
-- Rows go in as 'invited' (the booking-window check skips admin invites), then move to their real status.
select set_config('mdp.skip_dupr_gate', 'on', false);

update sessions set session_date = '2026-11-12', is_cancelled = false where label = 'Thursday Open Play';
update sessions set session_date = '2026-11-14', is_cancelled = false where label = 'Saturday Morning Open Play';
update sessions set session_date = '2026-11-17', is_cancelled = false where label = 'Tuesday Open Play';
update sessions set session_date = '2026-11-13', is_cancelled = false, published_at = null where label = 'Pickle Squad Friday';
update registrations r set session_date = s.session_date from sessions s
 where r.session_uuid = s.id and s.label in ('Thursday Open Play', 'Saturday Morning Open Play', 'Tuesday Open Play', 'Pickle Squad Friday');

-- Receipts waiting for a person on Thursday.
with s as (select * from sessions where label = 'Thursday Open Play'),
     proof as (select proof_url from registrations where proof_url is not null order by created_at desc limit 1),
     who as (select p.*, row_number() over (order by p.full_name) n from profiles p
             , s where p.full_name <> 'Nicolo Hallare'
               and not exists (select 1 from registrations r where r.session_uuid = s.id and r.user_id = p.id and r.status not in ('cancelled', 'rejected')))
insert into registrations (session_id, session_uuid, session_label, session_date, player_name, user_id, amount, credit_applied, gcash_paid,
  gcash_ref, proof_url, status, ai_check_status, ai_check_notes, booking_type, blocks_slot, extracted_amount, admin_note)
select s.id::text, s.id, s.label, s.session_date, who.full_name, who.id, s.fee, 0, 0, '00470' || (5550000 + who.n * 137)::text, proof.proof_url, 'invited',
  case when who.n = 1 then 'flagged' else 'pending' end,
  case when who.n = 1 then E'❌ FLAGGED: Amount sent (₱300) is less than the ₱' || s.fee || E' owed.\n\nAI reason: The receipt shows ₱300.' else null end,
  'solo', false, case when who.n = 1 then 300 else null end, 'demo-seed'
from s, proof, who where who.n <= 2;

-- An overpayment on Saturday: sent ₱800 for a ₱350 booking.
with s as (select * from sessions where label = 'Saturday Morning Open Play'),
     who as (select p.* from profiles p, s where p.full_name in ('Mia Santos', 'Paolo Santos', 'Juan Dela Cruz', 'Carlo Reyes', 'Ana Reyes')
             and not exists (select 1 from registrations r where r.session_uuid = s.id and r.user_id = p.id and r.status not in ('cancelled', 'rejected'))
             order by p.full_name limit 1)
insert into registrations (session_id, session_uuid, session_label, session_date, player_name, user_id, amount, credit_applied, gcash_paid,
  gcash_ref, status, ai_check_status, ai_check_notes, booking_type, blocks_slot, extracted_amount, admin_note)
select s.id::text, s.id, s.label, s.session_date, who.full_name, who.id, 350, 0, 350, '0047999888777', 'invited', 'approved',
  E'❌ FLAGGED: Overpaid: player sent ₱800 but only ₱350 was owed.', 'solo', false, 800, 'demo-seed-over'
from s, who
where not exists (select 1 from registrations r where r.session_uuid = s.id and (r.gcash_ref = '0047999888777' or (r.user_id = who.id and r.status not in ('cancelled', 'rejected'))));

update registrations set status = 'pending' where admin_note = 'demo-seed' and status = 'invited';
update registrations set status = 'paid' where admin_note = 'demo-seed-over' and status = 'invited';
update registrations set admin_note = null where admin_note in ('demo-seed', 'demo-seed-over');

select label, session_date, published_at is not null as published,
  (select count(*) from registrations r where r.session_uuid = s.id and r.status = 'pending') as to_check
from sessions s where session_date between '2026-11-10' and '2026-11-19' order by session_date;
