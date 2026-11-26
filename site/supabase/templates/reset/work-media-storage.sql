-- ============================================================================
-- Mercury FM – Work Media Storage Migration (Idempotent, Multi-Tenant)
-- Safe to re-run in the Supabase SQL Editor.
-- Does NOT drop media_chunks, change rooms PK, or delete existing data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Create PRIVATE Supabase Storage bucket "work-media"
--    20 MB limit, allowed MIME types for cleaner photos and finish videos.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-media',
  'work-media',
  false,
  20971520, -- 20 MB
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update
   set public = excluded.public,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 2. Storage RLS Policies on storage.objects
--    Object path format:
--      {schema_name}/{cleaner_id}/{yyyy-mm-dd}/{daily_task_id}_{start|finish}_{timestamp}.{ext}
--    Thumbnail path format:
--      {schema_name}/{cleaner_id}/{yyyy-mm-dd}/{daily_task_id}_{start|finish}_{timestamp}_thumb.jpg
-- ----------------------------------------------------------------------------
drop policy if exists work_media_insert_own on storage.objects;
create policy work_media_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'work-media'
    and (storage.foldername(name))[1] = public.my_schema()
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists work_media_select on storage.objects;
create policy work_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'work-media'
    and (
      public.is_org_staff((storage.foldername(name))[1])
      or (
        (storage.foldername(name))[1] = public.my_schema()
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

drop policy if exists work_media_delete_staff on storage.objects;
create policy work_media_delete_staff on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'work-media'
    and public.is_org_staff((storage.foldername(name))[1])
  );

-- ----------------------------------------------------------------------------
-- 3. Fix public.audit_log RLS policy (audit_log.org_id is uuid, in_org takes text schema)
-- ----------------------------------------------------------------------------
do $do$
begin
  if exists (
    select 1
      from information_schema.tables
     where table_schema = 'public'
       and table_name = 'audit_log'
  ) then
    drop policy if exists audit_log_select_admins on public.audit_log;
    create policy audit_log_select_admins on public.audit_log
      for select to authenticated
      using (
        public.is_platform_admin()
        or (
          public.my_role() = 'org_admin'
          and exists (
            select 1
              from public.organizations o
             where o.id = audit_log.org_id
               and public.in_org(o.schema_name)
          )
        )
      );
  end if;
end
$do$;

-- ----------------------------------------------------------------------------
-- 4. Multi-tenant helper: public.apply_work_media_to_schema(p_schema text)
--    Applies Storage columns, branch/room columns, indexes, RLS policies,
--    and Realtime publication entries to one tenant schema.
-- ----------------------------------------------------------------------------
create or replace function public.apply_work_media_to_schema(p_schema text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_schema is null or not exists (
    select 1 from public.organizations where schema_name = p_schema
  ) then
    raise exception 'Unknown organization schema: %', coalesce(p_schema, '<null>');
  end if;

  if not exists (
    select 1 from information_schema.schemata where schema_name = p_schema
  ) then
    raise notice 'Schema % does not exist yet; skipping.', p_schema;
    return;
  end if;

  -- 4a. Extend <schema>.media for Supabase Storage (keep legacy bytea rows working)
  execute format('alter table %1$I.media add column if not exists bucket text default ''work-media''', p_schema);
  execute format('alter table %1$I.media add column if not exists storage_path text', p_schema);
  execute format('alter table %1$I.media add column if not exists thumb_path text', p_schema);
  execute format('alter table %1$I.media add column if not exists duration_seconds numeric', p_schema);
  execute format('alter table %1$I.media add column if not exists width int', p_schema);
  execute format('alter table %1$I.media add column if not exists height int', p_schema);
  execute format('alter table %1$I.media alter column chunk_count drop not null', p_schema);
  execute format('alter table %1$I.media alter column chunk_count set default 0', p_schema);

  if not exists (
    select 1
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
     where n.nspname = p_schema
       and r.relname = 'media'
       and c.conname = 'media_storage_or_chunks_check'
  ) then
    execute format(
      'alter table %1$I.media add constraint media_storage_or_chunks_check check (storage_path is not null or chunk_count > 0)',
      p_schema
    );
  end if;

  -- 4b. Add optional branch_id and room_id to daily_tasks and task_runs
  execute format('alter table %1$I.daily_tasks add column if not exists branch_id text', p_schema);
  execute format('alter table %1$I.daily_tasks add column if not exists room_id text', p_schema);
  execute format('alter table %1$I.task_runs add column if not exists branch_id text', p_schema);
  execute format('alter table %1$I.task_runs add column if not exists room_id text', p_schema);

  -- 4c. Indexes on task_runs for feed and cleaner queries
  execute format(
    'create index if not exists task_runs_run_date_cleaner_idx on %1$I.task_runs (run_date, cleaner_id)',
    p_schema
  );
  execute format(
    'create index if not exists task_runs_started_at_idx on %1$I.task_runs (started_at desc)',
    p_schema
  );

  -- 4d. Allow cleaners to insert their own media rows directly from the browser
  execute format('drop policy if exists media_insert_own on %1$I.media', p_schema);
  execute format($p$
    create policy media_insert_own on %1$I.media
      for insert to authenticated
      with check (public.in_org(%1$L) and created_by = auth.uid())
  $p$, p_schema);

  -- Ensure authenticated privileges match existing tenant tables
  execute format('grant usage on schema %1$I to authenticated', p_schema);
  execute format('grant select, insert, update, delete on %1$I.media to authenticated', p_schema);
  execute format('grant select, insert, update, delete on %1$I.daily_tasks to authenticated', p_schema);
  execute format('grant select, insert, update, delete on %1$I.task_runs to authenticated', p_schema);
  execute format('grant usage, select on all sequences in schema %1$I to authenticated', p_schema);

  -- 4e. Add task_runs and room_status_history to supabase_realtime publication (guarded)
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = p_schema
         and tablename = 'task_runs'
    ) then
      execute format('alter publication supabase_realtime add table %1$I.task_runs', p_schema);
    end if;

    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = p_schema
         and tablename = 'room_status_history'
    ) then
      execute format('alter publication supabase_realtime add table %1$I.room_status_history', p_schema);
    end if;
  end if;
end
$fn$;

revoke all on function public.apply_work_media_to_schema(text) from public, anon, authenticated;
grant execute on function public.apply_work_media_to_schema(text) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Backfill ALL existing organizations
-- ----------------------------------------------------------------------------
do $backfill$
declare
  org record;
begin
  for org in
    select schema_name
      from public.organizations
     order by schema_name
  loop
    if exists (
      select 1 from information_schema.schemata where schema_name = org.schema_name
    ) then
      perform public.apply_work_media_to_schema(org.schema_name);
      raise notice 'Applied work_media migration to schema: %', org.schema_name;
    else
      raise notice 'Skipped missing schema: %', org.schema_name;
    end if;
  end loop;
end
$backfill$;

select public.refresh_exposed_schemas();
