-- ============================================================================
-- Mercury FM – Verify Tenant Setup
-- Lists for EVERY org_<slug> schema whether required columns, policies,
-- indexes, and realtime publication entries exist.
-- ============================================================================

with orgs as (
  select name, slug, schema_name, is_active
    from public.organizations
   order by schema_name
)
select
  o.schema_name,
  o.is_active,
  -- Media columns
  exists (
    select 1 from information_schema.columns c
     where c.table_schema = o.schema_name and c.table_name = 'media' and c.column_name = 'storage_path'
  ) as has_media_storage_path,
  exists (
    select 1 from information_schema.columns c
     where c.table_schema = o.schema_name and c.table_name = 'media' and c.column_name = 'thumb_path'
  ) as has_media_thumb_path,
  exists (
    select 1 from information_schema.columns c
     where c.table_schema = o.schema_name and c.table_name = 'media' and c.column_name = 'duration_seconds'
  ) as has_media_duration,
  -- Daily tasks & task_runs branch/room columns
  exists (
    select 1 from information_schema.columns c
     where c.table_schema = o.schema_name and c.table_name = 'daily_tasks' and c.column_name = 'branch_id'
  ) as has_daily_tasks_branch,
  exists (
    select 1 from information_schema.columns c
     where c.table_schema = o.schema_name and c.table_name = 'task_runs' and c.column_name = 'room_id'
  ) as has_task_runs_room,
  -- RLS policy media_insert_own
  exists (
    select 1 from pg_policies p
     where p.schemaname = o.schema_name and p.tablename = 'media' and p.policyname = 'media_insert_own'
  ) as has_media_insert_policy,
  -- Indexes on task_runs
  exists (
    select 1 from pg_indexes i
     where i.schemaname = o.schema_name and i.tablename = 'task_runs' and i.indexname = 'task_runs_run_date_cleaner_idx'
  ) as has_runs_cleaner_idx,
  exists (
    select 1 from pg_indexes i
     where i.schemaname = o.schema_name and i.tablename = 'task_runs' and i.indexname = 'task_runs_started_at_idx'
  ) as has_runs_started_idx,
  -- Realtime publication
  exists (
    select 1 from pg_publication_tables pt
     where pt.pubname = 'supabase_realtime' and pt.schemaname = o.schema_name and pt.tablename = 'task_runs'
  ) as realtime_task_runs,
  exists (
    select 1 from pg_publication_tables pt
     where pt.pubname = 'supabase_realtime' and pt.schemaname = o.schema_name and pt.tablename = 'room_status_history'
  ) as realtime_room_history
from orgs o;

-- Verify storage bucket & policies
select id, name, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'work-media';

select policyname, cmd, roles
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'work_media%';
