-- DEMO DATABASE ONLY (dupr-demo branch). Connects three demo players to the DUPR test
-- accounts used for the old app's testing on Oct 15, so games can be sent without
-- signing each of them in. Nicolo already connected himself (VLERDE) in the new app.
--   Izza  -> W57RVM    Meg -> 66MWVQ    Rorie -> EVQMZJ

insert into dupr_links (dupr_id, user_id, env, entitlements, connected_at, updated_at, entitlements_checked_at)
select x.dupr_id, u.id, 'uat', '["BASIC_L1"]'::jsonb, now(), now(), now()
from (values ('izza.demo@matchdaypickle.com', 'W57RVM'),
             ('meg.demo@matchdaypickle.com',  '66MWVQ'),
             ('rorie.demo@matchdaypickle.com','EVQMZJ')) x(email, dupr_id)
join auth.users u on u.email = x.email
on conflict (dupr_id) do update set user_id = excluded.user_id, env = 'uat', updated_at = now();

-- Show them as DUPR-connected on the court board and results screen (Nicolo too).
update profiles p set dupr_id = l.dupr_id, dupr_short_id = l.dupr_id
from dupr_links l where l.user_id = p.id and l.env = 'uat';

select p.full_name, l.dupr_id from dupr_links l join profiles p on p.id = l.user_id order by 1;
