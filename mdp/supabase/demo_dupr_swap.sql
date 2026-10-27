-- DEMO DATABASE ONLY (dupr-demo branch).
-- W57RVM is the DUPR test account that is DIRECTOR of the Match Day Pickle Test Club
-- (6416812389). Give it to Nicolo, and VLERDE (no club role) to Izza, as on the live app.

update dupr_links set user_id = (select id from auth.users where email = 'izza.demo@matchdaypickle.com'), updated_at = now()
 where dupr_id = 'VLERDE';
update dupr_links set user_id = (select id from auth.users where email = 'nicolo@hallare.com'),
       clubs = '{"membership": [{"role": "DIRECTOR", "clubId": 6416812389, "clubName": "Match Day Pickle Test Club"}]}'::jsonb,
       updated_at = now()
 where dupr_id = 'W57RVM';

update profiles p set dupr_id = l.dupr_id, dupr_short_id = l.dupr_id
from dupr_links l where l.user_id = p.id and l.env = 'uat';

select p.full_name, l.dupr_id, l.clubs->'membership'->0->>'role' as club_role
from dupr_links l join profiles p on p.id = l.user_id order by 1;
