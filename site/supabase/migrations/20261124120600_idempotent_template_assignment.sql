-- Make assigning a template to a cleaner/date idempotent.
-- The tenant.unique (work_date, cleaner_id, template_id) constraint previously
-- caused a duplicate-key error when the same assignment was submitted twice.
-- This RPC reuses the existing assignment and copies template tasks only once.
-- Additive/idempotent: create or replace, no drops, safe to re-run.

create or replace function public.assign_template_tasks(
  p_work_date date,
  p_cleaner_id uuid,
  p_template_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schema text;
  v_assignment bigint;
  v_has_tasks boolean;
begin
  v_schema := public.my_schema();
  if v_schema is null then
    raise exception 'No active organization is assigned to this account.';
  end if;
  if not public.is_org_staff(v_schema) then
    raise exception 'Permission denied.';
  end if;

  execute format($q$
    insert into %1$I.daily_assignments (work_date, cleaner_id, template_id)
    values ($1, $2, $3)
    on conflict (work_date, cleaner_id, template_id) do nothing
  $q$, v_schema) using p_work_date, p_cleaner_id, p_template_id;

  execute format($q$
    select id from %1$I.daily_assignments
     where work_date = $1 and cleaner_id = $2 and template_id = $3
     order by id desc limit 1
     for update
  $q$, v_schema) into v_assignment using p_work_date, p_cleaner_id, p_template_id;

  if v_assignment is null then
    raise exception 'Could not create or find the requested assignment.';
  end if;

  -- Only copy template tasks for a fresh assignment. Admin-added day-specific
  -- tasks and edits are preserved when the same assignment is opened again.
  execute format($q$
    select exists (select 1 from %1$I.daily_tasks where assignment_id = $1)
  $q$, v_schema) into v_has_tasks using v_assignment;

  if not v_has_tasks then
    execute format('select %1$I.load_template_tasks($1)', v_schema) using v_assignment;
  end if;

  return v_assignment;
end;
$$;

revoke all on function public.assign_template_tasks(date, uuid, bigint) from public, anon;
grant execute on function public.assign_template_tasks(date, uuid, bigint) to authenticated, service_role;

notify pgrst, 'reload schema';
