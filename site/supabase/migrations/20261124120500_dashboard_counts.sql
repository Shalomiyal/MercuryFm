-- Aggregate dashboard counters in one database call instead of downloading
-- every assignment and task run to the browser. Additive/idempotent.
create or replace function public.get_dashboard_counts(
  p_work_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_schema text;
  v_result jsonb;
begin
  v_schema := public.my_schema();
  if v_schema is null then
    return jsonb_build_object(
      'rooms_ready', 0,
      'rooms_cleaning', 0,
      'rooms_total', 0,
      'tasks_completed', 0,
      'tasks_pending', 0
    );
  end if;

  execute format($q$
    select jsonb_build_object(
             'rooms_ready',
               (select count(*) from %1$I.rooms where current_status = 'ready'),
             'rooms_cleaning',
               (select count(*) from %1$I.rooms where current_status = 'clean_start'),
             'rooms_total',
               (select count(*) from %1$I.rooms),
             'tasks_completed',
               (select count(*)
                  from %1$I.task_runs tr
                  join %1$I.daily_tasks dt on dt.id = tr.daily_task_id
                  join %1$I.daily_assignments da on da.id = dt.assignment_id
                 where da.work_date = $1 and tr.state = 'completed'),
             'tasks_pending',
               (select count(*)
                  from %1$I.daily_tasks dt
                  join %1$I.daily_assignments da on da.id = dt.assignment_id
                 where da.work_date = $1
                   and not exists (
                     select 1 from %1$I.task_runs tr
                      where tr.daily_task_id = dt.id and tr.state = 'completed'
                   ))
           )
  $q$, v_schema) into v_result using p_work_date;

  return coalesce(v_result, jsonb_build_object(
    'rooms_ready', 0,
    'rooms_cleaning', 0,
    'rooms_total', 0,
    'tasks_completed', 0,
    'tasks_pending', 0
  ));
end;
$$;

revoke all on function public.get_dashboard_counts(date) from public, anon;
grant execute on function public.get_dashboard_counts(date) to authenticated, service_role;

notify pgrst, 'reload schema';
