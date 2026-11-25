-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- room_status_history.created_by is written with the acting user's id from
-- public.profiles. org_admin accounts live only in public.profiles, never in
-- org_<slug>.members, so a foreign key to members rejects their status updates.
-- Repoint the constraint to public.profiles(id), which contains every role
-- allowed to manage room status (org_admin, admin, cleaner).

do $$
declare
  s   text;
  con text;
begin
  for s in
    select o.schema_name
      from public.organizations o
     where o.schema_name like 'org\_%'
       and to_regclass(format('%I.room_status_history', o.schema_name)) is not null
  loop
    -- Remove any existing foreign key on room_status_history.created_by,
    -- including the one that points at org_<slug>.members(id).
    for con in
      select c.conname
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = s
         and t.relname = 'room_status_history'
         and c.contype = 'f'
         and exists (
           select 1
             from pg_attribute a
            where a.attrelid = t.oid
              and a.attname = 'created_by'
              and a.attnum = any(c.conkey)
         )
    loop
      execute format('alter table %I.room_status_history drop constraint %I', s, con);
    end loop;

    execute format($ddl$
      alter table %1$I.room_status_history
        add constraint room_status_history_created_by_fkey
        foreign key (created_by) references public.profiles(id)
        on delete set null
    $ddl$, s);
  end loop;
end $$;

notify pgrst, 'reload schema';
