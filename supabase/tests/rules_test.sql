-- Courtside rules test. Run on a fresh database after local_shim.sql + migrations.
-- Every scenario here maps to a lesson from MDP or a money path.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok  %', label;
end $$;
create or replace function public.t_err(stmt text, pattern text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then raise notice 'ok  % (%)', label, sqlerrm; return; end if;
    raise exception 'FAIL: % — wrong error: %', label, sqlerrm;
  end;
  raise exception 'FAIL: % — expected an error', label;
end $$;
create or replace function public.t_as(uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false); end $$;
grant execute on function public.t_ok(boolean, text), public.t_err(text, text, text), public.t_as(uuid) to public;

create temp table ids (k text primary key, v uuid);
grant all on ids to public;
set client_min_messages = notice;

-- people
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'nicolo@x.ph', '{"full_name":"Nicolo Platform"}'),
  ('00000000-0000-0000-0000-00000000000b', 'owner@x.ph',  '{"full_name":"Olive Owner"}'),
  ('00000000-0000-0000-0000-000000000001', 'ana@x.ph',    '{"full_name":"Ana Reyes"}'),
  ('00000000-0000-0000-0000-000000000002', 'ben@x.ph',    '{"full_name":"Ben Cruz"}'),
  ('00000000-0000-0000-0000-000000000003', 'cai@x.ph',    '{"full_name":"Cai Santos"}'),
  ('00000000-0000-0000-0000-000000000004', 'dan@x.ph',    '{"full_name":"Dan Flagged"}');
update profiles set is_platform_admin = true where id = '00000000-0000-0000-0000-00000000000a';
update profiles set phone = '0917' || right(id::text, 7) where id <> '00000000-0000-0000-0000-000000000004';

set role authenticated;

-- ── club setup ──────────────────────────────────────────────────────
select t_as('00000000-0000-0000-0000-000000000001');
select t_err($$select create_club('X','x-club','XX')$$, 'platform admins', 'players cannot create clubs');

select t_as('00000000-0000-0000-0000-00000000000a');
insert into ids select 'club', create_club('Sunrise Pickle', 'sunrise', 'SUN', 'Pasig', '00000000-0000-0000-0000-00000000000b');

select t_as('00000000-0000-0000-0000-00000000000b');
select update_club((select v from ids where k='club'),
  '{"gcash_number":"0917 123 4567","gcash_name":"Olive O.","is_published":true,"refund_cutoff_hours":24}');
select t_err($$select update_club((select v from ids where k='club'), '{"techpay_enabled":true}')$$,
  'platform team', 'owner cannot switch on TechPay (platform onboarding)');
insert into ids select 'c1', upsert_court((select v from ids where k='club'), null, 'Court 1', 400);
insert into ids select 'c2', upsert_court((select v from ids where k='club'), null, 'Court 2', 400);
select save_rate_rule((select v from ids where k='club'), null, 'Evening peak', null, '{1,2,3,4,5}', '17:00', '22:00', 600, 1);
select publish_house_rules((select v from ids where k='club'), 'Be on time. Paddles down when the host calls it.');

-- session in ~48h on court 1, ₱200, 4 seats
insert into ids select 'sess', create_session((select v from ids where k='club'), 'Tuesday Open Play',
  date_trunc('hour', now()) + interval '48 hours', date_trunc('hour', now()) + interval '51 hours', 200, 4,
  array[(select v from ids where k='c1')]);
select t_err($$select create_session((select v from ids where k='club'), 'Clash',
  date_trunc('hour', now()) + interval '49 hours', date_trunc('hour', now()) + interval '50 hours', 200, 4,
  array[(select v from ids where k='c1')])$$, 'already booked', 'two sessions cannot share a court');

-- ── joining & rules gate ────────────────────────────────────────────
select t_as('00000000-0000-0000-0000-000000000001');
select t_err($$select book_session((select v from ids where k='sess'), '{}')$$, 'Join this club', 'must join first');
select join_club((select v from ids where k='club'));
select t_err($$select book_session((select v from ids where k='sess'), '{}')$$, 'house rules', 'must accept house rules');
select accept_house_rules((select v from ids where k='club'), 1);

select t_as('00000000-0000-0000-0000-000000000004');
select accept_house_rules((select v from ids where k='club'), 1);
select t_err($$select book_session((select v from ids where k='sess'), '{}')$$, 'mobile number', 'phone required (for refunds)');

-- owner flags Dan
select t_as('00000000-0000-0000-0000-00000000000b');
select set_member_role((select v from ids where k='club'), '00000000-0000-0000-0000-000000000004', 'flagged', 'No-show twice');
reset role; update profiles set phone = '09170000004' where id = '00000000-0000-0000-0000-000000000004'; set role authenticated;
select t_as('00000000-0000-0000-0000-000000000004');
select t_err($$select book_session((select v from ids where k='sess'), '{}')$$, 'Booking opens', 'flagged: 1-hour window enforced on the server');

-- ── booking, capacity, waitlist ─────────────────────────────────────
select t_as('00000000-0000-0000-0000-000000000001');
select t_err($$select book_session((select v from ids where k='sess'), '{"G1","G2"}')$$, 'up to 1 guest', 'member guest limit');
insert into ids select 'bA', (book_session((select v from ids where k='sess'), '{"Ana guest"}')->>'booking_id')::uuid;
select t_ok((select status = 'pending_payment' and amount = 400 and seats = 2 from session_bookings where id = (select v from ids where k='bA')),
  'Ana holds 2 seats, owes ₱400');
select t_err($$select book_session((select v from ids where k='sess'), '{}')$$, 'already have a booking', 'one live booking per player');

select t_as('00000000-0000-0000-0000-000000000002');
select accept_house_rules((select v from ids where k='club'), 1);
insert into ids select 'bB', (book_session((select v from ids where k='sess'), '{"Ben guest"}')->>'booking_id')::uuid;

select t_as('00000000-0000-0000-0000-000000000003');
select accept_house_rules((select v from ids where k='club'), 1);
select t_ok((book_session((select v from ids where k='sess'), '{}')->>'status') = 'waitlist_pending_payment',
  'Cai goes to waitlist when full (held seats count)');
insert into ids select 'bC', id from session_bookings where user_id = '00000000-0000-0000-0000-000000000003';

-- ── GCash receipt path ──────────────────────────────────────────────
select t_as('00000000-0000-0000-0000-000000000001');
select t_err($$select submit_receipt('session_booking', (select v from ids where k='bA'), 'someone-else/x.jpg')$$,
  'Upload your receipt', 'receipt must be in the payer''s own folder');
insert into ids select 'pA', submit_receipt('session_booking', (select v from ids where k='bA'),
  '00000000-0000-0000-0000-000000000001/r1.jpg', '1234 567 890123');
select t_err($$select submit_receipt('session_booking', (select v from ids where k='bA'), '00000000-0000-0000-0000-000000000001/r2.jpg')$$,
  'already being checked', 'no second receipt while one is being checked');
select t_err($$select record_receipt_check((select v from ids where k='pA'), 'approved', 'x', '{}', '1')$$,
  'permission denied', 'players cannot approve their own receipt');

set role service_role;
select t_ok((record_receipt_check((select v from ids where k='pA'), 'approved', 'All checks passed',
  '{"detected_amount_php":400}', '1234567890123')->>'outcome') = 'confirmed', 'AI-approved receipt confirms Ana');
select t_ok((record_receipt_check((select v from ids where k='pA'), 'approved', 'again', '{}', '1234567890123')->>'already') = 'approved',
  'receipt check is idempotent');
set role authenticated;

-- Ben reuses Ana's receipt
select t_as('00000000-0000-0000-0000-000000000002');
insert into ids select 'pB', submit_receipt('session_booking', (select v from ids where k='bB'), '00000000-0000-0000-0000-000000000002/r.jpg');
set role service_role;
select t_ok((record_receipt_check((select v from ids where k='pB'), 'approved', 'looks fine', '{}', '1234-567-890-123')->>'result') = 'duplicate',
  'reused GCash reference is rejected');
set role authenticated;
select t_ok((select status = 'pending_payment' from session_bookings where id = (select v from ids where k='bB')),
  'Ben keeps his hold to retry');

-- Ben's real receipt is flagged; host approves it
insert into ids select 'pB2', submit_receipt('session_booking', (select v from ids where k='bB'), '00000000-0000-0000-0000-000000000002/r2.jpg');
set role service_role;
select record_receipt_check((select v from ids where k='pB2'), 'flagged', 'Amount unclear', '{"detected_reference":"9998887776665"}', '9998887776665');
set role authenticated;
select t_err($$select review_payment((select v from ids where k='pB2'), true, 'ok')$$, 'Not allowed', 'players cannot review payments');
select t_as('00000000-0000-0000-0000-00000000000b');
select t_err($$select review_payment((select v from ids where k='pB2'), true, '')$$, 'short note', 'review needs a note');
select t_ok((review_payment((select v from ids where k='pB2'), true, 'Checked GCash app, received')->>'outcome') = 'confirmed',
  'owner approves flagged receipt');
select t_ok(exists (select 1 from audit_log where action = 'payment.approve' and target_id = (select v from ids where k='pB2')),
  'override is in the audit log');

-- Cai pays the waitlist deposit
select t_as('00000000-0000-0000-0000-000000000003');
insert into ids select 'pC', submit_receipt('session_booking', (select v from ids where k='bC'), '00000000-0000-0000-0000-000000000003/r.jpg');
set role service_role;
select record_receipt_check((select v from ids where k='pC'), 'approved', 'ok', '{}', '5555555555555');
set role authenticated;
select t_ok((select status = 'waitlisted' and paid_amount = 200 from session_bookings where id = (select v from ids where k='bC')),
  'Cai is paid and waitlisted');

-- ── RLS ─────────────────────────────────────────────────────────────
select t_as('00000000-0000-0000-0000-000000000002');
select t_ok((select count(*) from payments where user_id = '00000000-0000-0000-0000-000000000001') = 0, 'Ben cannot see Ana''s payments');
select t_ok((select count(*) from payments) = 2, 'Ben sees his own payments');
select t_err($$update session_bookings set status = 'confirmed'$$, 'permission denied', 'no direct table writes');
select t_err($$select session_roster((select v from ids where k='sess'))$$, 'Not allowed', 'roster is staff only');
select t_as('00000000-0000-0000-0000-00000000000b');
select t_ok((select count(*) from session_roster((select v from ids where k='sess'))) = 3, 'owner sees roster');

-- ── cancellation, promotion, refund ─────────────────────────────────
select t_as('00000000-0000-0000-0000-000000000001');
select t_ok((cancel_session_booking((select v from ids where k='bA'))->>'refund')::numeric = 400, 'early cancel: full refund owed');
select t_ok((select count(*) from session_bookings where id = (select v from ids where k='bC')) = 0, 'Ana cannot see Cai''s booking');
select t_as('00000000-0000-0000-0000-00000000000b');
select t_ok((select status = 'confirmed' from session_bookings where id = (select v from ids where k='bC')), 'Cai promoted from waitlist');
select t_as('00000000-0000-0000-0000-000000000001');
select t_ok((select count(*) from refunds where user_id = '00000000-0000-0000-0000-000000000001' and status = 'owed' and amount = 400) = 1,
  'refund record exists for Ana');
select t_ok((select count(*) from my_money() where kind = 'refund') = 1, 'Ana sees the refund in her money history');

select t_as('00000000-0000-0000-0000-00000000000b');
select t_err($$select settle_refund((select id from refunds limit 1), 'paid', '')$$, 'Add a note', 'refund settle needs a note');
select settle_refund((select id from refunds where user_id = '00000000-0000-0000-0000-000000000001'), 'paid', 'GCash ref 777');

-- ── TechPay settle path ─────────────────────────────────────────────
reset role;
update clubs set techpay_enabled = true;
update app_config set value = 'true' where key = 'gateway_live';
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000001');
insert into ids select 'bA2', (book_session((select v from ids where k='sess'), '{}')->>'booking_id')::uuid;
select t_err($$select start_gateway_payment('session_booking', (select v from ids where k='bA2'), 'CSXXX123456')$$, 'Bad reference', 'reference must carry the club code');
select start_gateway_payment('session_booking', (select v from ids where k='bA2'), 'CSSUNTEST0001');
set role service_role;
select t_ok((settle_gateway_payment('CSSUNTEST0001', 150, 'completed')->>'reason') = 'amount mismatch', 'amount mismatch is held');
reset role; update payments set status = 'pending' where gateway_ref = 'CSSUNTEST0001'; set role service_role;
select t_ok((settle_gateway_payment('CSSUNTEST0001', 200, 'completed', 3.5)->>'outcome') = 'confirmed', 'verified TechPay payment confirms');
select t_ok((settle_gateway_payment('CSSUNTEST0001', 200, 'completed', 3.5)->>'already')::boolean, 'webhook retries settle once');
set role authenticated;
select t_ok((select status = 'confirmed' and paid_amount = 200 from session_bookings where id = (select v from ids where k='bA2')),
  'booking marked paid by the payment');

-- ── court rental ────────────────────────────────────────────────────
select t_as('00000000-0000-0000-0000-000000000002');
-- tomorrow 18:00–20:00 Manila on court 2 (weekday peak ₱600/h unless weekend)
insert into ids select 'cb1', (book_court((select v from ids where k='c2'),
  (((now() at time zone 'Asia/Manila')::date + 2)::timestamp + time '18:00') at time zone 'Asia/Manila',
  (((now() at time zone 'Asia/Manila')::date + 2)::timestamp + time '20:00') at time zone 'Asia/Manila')->>'booking_id')::uuid;
select t_ok((select amount in (1200, 800) from court_bookings where id = (select v from ids where k='cb1')), 'court price uses peak rule on weekdays');
select t_as('00000000-0000-0000-0000-000000000003');
select t_err($$select book_court((select v from ids where k='c2'),
  (((now() at time zone 'Asia/Manila')::date + 2)::timestamp + time '19:00') at time zone 'Asia/Manila',
  (((now() at time zone 'Asia/Manila')::date + 2)::timestamp + time '20:00') at time zone 'Asia/Manila')$$, 'just took that slot', 'no double booking of a court');
select t_err($$select book_court((select v from ids where k='c2'),
  (((now() at time zone 'Asia/Manila')::date + 2)::timestamp + time '19:30') at time zone 'Asia/Manila',
  (((now() at time zone 'Asia/Manila')::date + 2)::timestamp + time '21:30') at time zone 'Asia/Manila')$$, 'minute mark', 'slots align to the grid');
select t_err($$select book_court((select v from ids where k='c2'),
  (((now() at time zone 'Asia/Manila')::date + 2)::timestamp + time '03:00') at time zone 'Asia/Manila',
  (((now() at time zone 'Asia/Manila')::date + 2)::timestamp + time '04:00') at time zone 'Asia/Manila')$$, 'opening hours', 'opening hours enforced');
select t_err($$select book_court((select v from ids where k='c1'),
  date_trunc('hour', now()) + interval '48 hours', date_trunc('hour', now()) + interval '49 hours')$$, 'just took', 'cannot rent a court used by a session');

-- Ben's hold lapses; Cai takes the slot; Ben's late payment becomes a refund
reset role;
update court_bookings set hold_expires_at = now() - interval '1 minute' where id = (select v from ids where k='cb1');
set role service_role;
select t_ok((run_maintenance()->>'court_holds_expired')::int = 1, 'hourly job expires lapsed court hold');
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000003');
insert into ids select 'cb2', (book_court((select v from ids where k='c2'),
  (((now() at time zone 'Asia/Manila')::date + 2)::timestamp + time '18:00') at time zone 'Asia/Manila',
  (((now() at time zone 'Asia/Manila')::date + 2)::timestamp + time '19:00') at time zone 'Asia/Manila')->>'booking_id')::uuid;
reset role;
insert into payments (club_id, user_id, purpose, purpose_id, amount, method, status, gateway_ref)
values ((select v from ids where k='club'), '00000000-0000-0000-0000-000000000002', 'court_booking',
  (select v from ids where k='cb1'), (select amount from court_bookings where id = (select v from ids where k='cb1')), 'techpay', 'pending', 'CSSUNLATE0001');
set role service_role;
select t_ok((settle_gateway_payment('CSSUNLATE0001', (select amount from court_bookings where id = (select v from ids where k='cb1')), 'completed')->>'outcome') = 'refund_owed',
  'late payment for a taken court becomes a refund (money never lost)');
select t_ok((run_maintenance()->>'paid_not_booked')::int = 0, 'paid-not-booked monitor: nothing unaccounted');

-- ── session starts: waitlist deposit returns ───────────────────────
reset role;
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000b');
insert into ids select 'sess2', create_session((select v from ids where k='club'), 'Small Session',
  date_trunc('hour', now()) + interval '30 hours', date_trunc('hour', now()) + interval '32 hours', 150, 1, '{}');
select t_as('00000000-0000-0000-0000-000000000001');
select book_session((select v from ids where k='sess2'), '{}');
select t_as('00000000-0000-0000-0000-000000000002');
insert into ids select 'bW', (book_session((select v from ids where k='sess2'), '{}')->>'booking_id')::uuid;
insert into ids select 'pW', submit_receipt('session_booking', (select v from ids where k='bW'), '00000000-0000-0000-0000-000000000002/w.jpg');
set role service_role;
select record_receipt_check((select v from ids where k='pW'), 'approved', 'ok', '{}', '4444444444444');
reset role;
update sessions set starts_at = now() - interval '5 minutes', ends_at = now() + interval '1 hour' where id = (select v from ids where k='sess2');
set role service_role;
select t_ok((run_maintenance()->>'waitlist_refunds')::int = 1, 'waitlist deposit returned when session starts');
select t_ok((select status = 'expired' from session_bookings where id = (select v from ids where k='bW')), 'waitlist booking closed');

-- ── club cancels a session ──────────────────────────────────────────
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000b');
select t_ok((cancel_session((select v from ids where k='sess'), 'Venue flooded')->>'refunds_owed')::numeric = 800,
  'cancelling a session owes every paid player a refund (Ben 400 + Cai 200 + Ana 200)');
select t_ok((select count(*) from court_reservations where source_id = (select v from ids where k='sess') and active) = 0,
  'session courts released');

-- ── dashboard ───────────────────────────────────────────────────────
select t_ok((club_dashboard((select v from ids where k='club'), now() - interval '1 day', now() + interval '1 day')->>'refunds_owed')::numeric > 0,
  'dashboard shows refunds owed');

-- ── payouts: platform collects, pays each club its share ───────────
reset role;
select t_ok((select count(*) from club_ledger where kind = 'collection')
            = (select count(*) from payments where method = 'techpay' and status = 'approved' and not is_test),
  'every approved TechPay payment credits the club ledger once');
select t_ok((select coalesce(sum(l.amount), 0) from club_ledger l
             left join refunds r on r.id = l.refund_id
             where l.payment_id = (select id from payments where gateway_ref = 'CSSUNLATE0001')
                or r.payment_id = (select id from payments where gateway_ref = 'CSSUNLATE0001')) = 0,
  'a late payment that became a refund nets to zero for the club');
select t_ok((select count(*) from refunds where paid_by = 'platform') >= 1,
  'refunds on TechPay bookings are paid by the platform');
select t_ok((select bool_and(paid_by = 'club') from refunds where id not in (
              select r.id from refunds r join payments p on p.purpose_id = r.purpose_id
              where p.method = 'techpay' and p.status = 'approved')),
  'refunds on receipt or cash bookings stay with the club');

set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000b');
select t_err($$select settle_refund((select id from refunds where paid_by = 'platform' and status = 'owed' limit 1), 'paid', 'GCash ref 999')$$,
  'Match Day Pickle sends', 'a club cannot mark a platform refund as paid');
insert into ids select 'rW', (select id from refunds where paid_by = 'platform' and status = 'owed' order by created_at limit 1);
select settle_refund((select v from ids where k='rW'), 'waived', 'Player took club credit instead');
select t_ok((select count(*) from club_ledger where refund_id = (select v from ids where k='rW') and kind = 'refund_waived') = 1,
  'waiving a platform refund returns the money to the club');

select t_err($$select set_payout_account((select v from ids where k='club'), 'bank', '', 'Sunrise Pickle Club', '001234567890', 'club')$$,
  'Enter the bank', 'bank payouts need the bank name');
select set_payout_account((select v from ids where k='club'), 'bank', 'BPI', 'Sunrise Pickle Club', '0012-3456-7890', 'club');
select t_ok((club_payout_summary((select v from ids where k='club'))->'account'->>'last4') = '7890', 'club sees its account, masked');

select t_as('00000000-0000-0000-0000-000000000001');
select t_ok((select count(*) from club_ledger) = 0, 'players cannot see a club''s ledger');
select t_ok((select count(*) from payout_accounts) = 0, 'players cannot see payout accounts');
select t_err($$select * from run_payouts()$$, 'platform team', 'only the platform runs payouts');

select t_as('00000000-0000-0000-0000-00000000000a');
select t_ok((select count(*) from run_payouts() where payout_id is not null) = 0, 'nothing is paid out during the chargeback hold');
reset role;
-- a manual top-up so the balance is clearly positive, then let the hold pass
insert into club_ledger (club_id, kind, amount, note) values ((select v from ids where k='club'), 'adjustment', 1000, 'test top-up');
update club_ledger set available_at = now() - interval '1 minute';
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
select t_ok((select skipped from run_payouts() where club_id = (select v from ids where k='club')) = 'Payout account not verified',
  'no money goes to an unverified account');
select t_err($$select verify_payout_account((select v from ids where k='club'), '')$$, 'how you checked', 'verifying needs a note');
select verify_payout_account((select v from ids where k='club'), 'Business permit seen; ₱1 test received');
insert into ids select 'po1', (select payout_id from run_payouts() where club_id = (select v from ids where k='club'));
select t_ok((select amount from payouts where id = (select v from ids where k='po1'))
            = (select sum(amount) from club_ledger where payout_id = (select v from ids where k='po1')),
  'the payout equals the ledger lines it covers');
select t_ok((select count(*) from run_payouts() where payout_id is not null) = 0, 'a second run pays nothing twice');
select mark_payout((select v from ids where k='po1'), 'failed', 'Account name mismatch');
select t_ok((select count(*) from club_ledger where payout_id = (select v from ids where k='po1')) = 0,
  'a failed payout releases its lines');
insert into ids select 'po2', (select payout_id from run_payouts() where club_id = (select v from ids where k='club'));
select t_err($$select mark_payout((select v from ids where k='po2'), 'sent', '')$$, 'reference', 'sent payouts need the transfer reference');
select mark_payout((select v from ids where k='po2'), 'sent', 'INSTAPAY 20261006-0042');
select t_ok((platform_money()->>'held_for_clubs')::numeric = 0, 'after the payout the platform holds nothing for the club');

select t_as('00000000-0000-0000-0000-00000000000b');
select t_ok((club_payout_summary((select v from ids where k='club'))->>'paid_out')::numeric
            = (select amount from payouts where id = (select v from ids where k='po2')),
  'the club sees what was paid out');
select set_payout_account((select v from ids where k='club'), 'gcash', null, 'Olive Owner', '0917 123 4567', 'organizer');
select t_ok((club_payout_summary((select v from ids where k='club'))->'account'->>'verified')::boolean = false,
  'changing the account needs a fresh check');

reset role;
select t_ok((select count(*) from audit_log where action like 'payout%') >= 5, 'payouts leave a trail');
select 'ALL TESTS PASSED' as result;
