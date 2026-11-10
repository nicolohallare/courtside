-- Standard booking windows for every session (agreed Nov 11, 2026).
-- Varsity 2 weeks, Member 5 days, Community 3 days, Flagged 1 hour before the session starts.
-- The new app's session form also writes Varsity and Member opening times from these same numbers;
-- Community and Flagged take the later of the Member opening and their own window (enforce_tier_window).
update app_config set value = case key
  when 'lead_hours_varsity' then '336' when 'lead_hours_member' then '120'
  when 'lead_hours_community' then '72' when 'lead_hours_flagged' then '1' end
where key in ('lead_hours_varsity', 'lead_hours_member', 'lead_hours_community', 'lead_hours_flagged');
select key, value from app_config where key like 'lead_hours_%' order by 1;
