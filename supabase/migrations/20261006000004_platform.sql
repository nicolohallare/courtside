-- Supabase platform pieces: private receipts bucket and the maintenance schedule.
-- (Not run in the local Postgres tests.)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Players upload into their own folder: <user_id>/<file>
create policy receipts_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy receipts_read_own on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
-- Club staff can view receipts attached to their club's payments
create policy receipts_read_staff on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and exists (
    select 1 from public.payments p where p.proof_path = storage.objects.name and public.is_club_staff(p.club_id)));

-- Holds expire, waitlist deposits return, monitors run: every 5 minutes.
create extension if not exists pg_cron;
select cron.schedule('courtside-maintenance', '*/5 * * * *', $$select public.run_maintenance()$$);
