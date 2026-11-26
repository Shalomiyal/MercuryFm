-- ============================================================================
-- Mercury FM – Room Status Lifecycle & Automated Sync Migration
-- Safe to run and re-run in the Supabase SQL Editor.
-- Enforces:
--   1. Cleaners can record 'clean_start' and 'clean_finished' in room_status_history
--   2. Automatic task_runs trigger to sync room status when cleaning starts/finishes
-- ============================================================================

do $$
declare
  s text;
begin
  for s in
    select o.schema_name
      from public.organizations o
     where o.schema_name like 'org\_%'
       and to_regclass(quote_ident(o.schema_name) || '.room_status_history') is not null
  loop
    -- 1. Update RLS policy to allow cleaners to insert clean_start and clean_finished
    execute format('drop policy if exists hist_write on %1$I.room_status_history', s);
    execute format($pol$
      create policy hist_write on %1$I.room_status_history
        for insert with check (
          public.is_org_staff(%1$L)
          or (public.in_org(%1$L) and status in ('clean_start', 'clean_finished'))
        )
    $pol$, s);

    -- 2. Trigger function to auto-sync room status on task_runs start & completion
    execute format($fn_ddl$
      create or replace function %1$I.sync_task_run_to_room_status()
      returns trigger
      language plpgsql
      security definer
      as $fn$
      declare
        v_room text := coalesce(
          new.room_id,
          (select dt.room_id from %1$I.daily_tasks dt where dt.id = new.daily_task_id)
        );
      begin
        if v_room is not null and v_room <> '' then
          if tg_op = 'INSERT' and new.state = 'in_progress' then
            insert into %1$I.room_status_history (room_id, status, status_time, created_by)
            values (v_room, 'clean_start', coalesce(new.started_at, now()), new.cleaner_id);
          elsif tg_op = 'UPDATE' and new.state = 'completed' and (old.state is distinct from 'completed') then
            insert into %1$I.room_status_history (room_id, status, status_time, created_by)
            values (v_room, 'clean_finished', coalesce(new.finished_at, now()), new.cleaner_id);
          end if;
        end if;
        return new;
      end
      $fn$;
    $fn_ddl$, s);

    execute format('drop trigger if exists trg_task_run_room_status on %1$I.task_runs', s);
    execute format($trg$
      create trigger trg_task_run_room_status
        after insert or update on %1$I.task_runs
        for each row execute function %1$I.sync_task_run_to_room_status()
    $trg$, s);
  end loop;
end $$;

notify pgrst, 'reload schema';
