-- Add optional media attachment to room_status_history
-- Idempotent — safe to run more than once.
-- Run in the Supabase SQL Editor.

do $migration$
declare
  org record;
  s   text;
begin
  for org in
    select schema_name from public.organizations order by schema_name
  loop
    s := org.schema_name;
    if not exists (
      select 1 from information_schema.schemata where schema_name = s
    ) then continue; end if;

    -- Add nullable media_id so existing rows are unaffected
    execute format(
      'alter table %1$I.room_status_history add column if not exists media_id uuid references %1$I.media(id) on delete set null',
      s
    );
  end loop;
end $migration$;

notify pgrst, 'reload schema';
