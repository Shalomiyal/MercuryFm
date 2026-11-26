-- Grant service_role access to tenant schemas for server-side operations
-- (update-room-status API, media uploads via API, etc.)
-- The service_role bypasses RLS so we scope it carefully to only
-- room_status_history and media tables.
-- Run in Supabase SQL Editor.

do $grant$
declare
  s text;
begin
  for s in
    select schema_name from public.organizations order by schema_name
  loop
    -- Allow service_role to use the schema
    execute format('grant usage on schema %1$I to service_role', s);

    -- Allow service_role to insert/select on the specific tables needed server-side
    execute format('grant select, insert, update on %1$I.room_status_history to service_role', s);
    execute format('grant select, insert on %1$I.media to service_role', s);
    execute format('grant select on %1$I.rooms to service_role', s);
    execute format('grant select on %1$I.branches to service_role', s);
    execute format('grant select on %1$I.members to service_role', s);
    execute format('grant select on %1$I.daily_tasks to service_role', s);
    execute format('grant select on %1$I.daily_assignments to service_role', s);
    execute format('grant select on %1$I.task_runs to service_role', s);
    execute format('grant select on %1$I.task_templates to service_role', s);
    execute format('grant select on %1$I.template_tasks to service_role', s);
  end loop;
end $grant$;

notify pgrst, 'reload schema';
