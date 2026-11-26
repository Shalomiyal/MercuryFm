-- Task start times + per-task custom fields.
-- Idempotent: safe to run more than once. Run in the Supabase SQL Editor.
-- Applies to every existing org_<slug> schema listed in public.organizations.
-- New organizations get the same structure from docs/platform.sql.

do $migration$
declare
  org record;
  s text;
begin
  for org in
    select schema_name
      from public.organizations
     order by schema_name
  loop
    s := org.schema_name;

    if not exists (
      select 1 from information_schema.schemata where schema_name = s
    ) then
      continue;
    end if;

    -- Start/end times and a stable link from a copied daily task back to its template task.
    execute format('alter table %1$I.template_tasks add column if not exists start_by time', s);
    execute format('alter table %1$I.daily_tasks add column if not exists start_by time', s);
    execute format(
      'alter table %1$I.daily_tasks add column if not exists template_task_id bigint references %1$I.template_tasks(id) on delete set null',
      s
    );

    -- Definitions live on the template task; entered values live on each day's copied task.
    execute format($ddl$
      create table if not exists %1$I.task_fields (
        id            bigint generated always as identity primary key,
        task_id       bigint not null references %1$I.template_tasks(id) on delete cascade,
        field_name    text not null,
        default_value text,
        sort_order    int not null default 0,
        unique (task_id, field_name)
      );

      create table if not exists %1$I.daily_task_field_values (
        id            bigint generated always as identity primary key,
        daily_task_id bigint not null references %1$I.daily_tasks(id) on delete cascade,
        field_name    text not null,
        field_value   text,
        sort_order    int not null default 0,
        unique (daily_task_id, field_name)
      );
    $ddl$, s);

    -- Defensive additions for partially applied earlier runs.
    execute format('alter table %1$I.task_fields add column if not exists default_value text', s);
    execute format('alter table %1$I.task_fields add column if not exists sort_order int not null default 0', s);
    execute format('alter table %1$I.daily_task_field_values add column if not exists sort_order int not null default 0', s);

    -- RLS: staff manage definitions and values; cleaners read/update values on their own tasks.
    execute format('alter table %1$I.task_fields enable row level security', s);
    execute format('alter table %1$I.daily_task_field_values enable row level security', s);

    execute format('drop policy if exists tf_all on %1$I.task_fields', s);
    execute format($p$
      create policy tf_all on %1$I.task_fields
      for all using (public.is_org_staff(%1$L))
      with check (public.is_org_staff(%1$L))
    $p$, s);

    execute format('drop policy if exists dtfv_staff on %1$I.daily_task_field_values', s);
    execute format($p$
      create policy dtfv_staff on %1$I.daily_task_field_values
      for all using (public.is_org_staff(%1$L))
      with check (public.is_org_staff(%1$L))
    $p$, s);

    execute format('drop policy if exists dtfv_own_select on %1$I.daily_task_field_values', s);
    execute format($p$
      create policy dtfv_own_select on %1$I.daily_task_field_values
      for select using (
        public.in_org(%1$L)
        and exists (
          select 1
            from %1$I.daily_tasks dt
            join %1$I.daily_assignments a on a.id = dt.assignment_id
           where dt.id = daily_task_id
             and a.cleaner_id = auth.uid()
        )
      )
    $p$, s);

    execute format('drop policy if exists dtfv_own_update on %1$I.daily_task_field_values', s);
    execute format($p$
      create policy dtfv_own_update on %1$I.daily_task_field_values
      for update using (
        public.in_org(%1$L)
        and exists (
          select 1
            from %1$I.daily_tasks dt
            join %1$I.daily_assignments a on a.id = dt.assignment_id
           where dt.id = daily_task_id
             and a.cleaner_id = auth.uid()
        )
      )
      with check (
        public.in_org(%1$L)
        and exists (
          select 1
            from %1$I.daily_tasks dt
            join %1$I.daily_assignments a on a.id = dt.assignment_id
           where dt.id = daily_task_id
             and a.cleaner_id = auth.uid()
        )
      )
    $p$, s);

    -- Copy start time and custom-field defaults when a template is assigned.
    execute format($fn$
      create or replace function %1$I.load_template_tasks(p_assignment bigint)
      returns void
      language plpgsql
      security definer
      set search_path = %1$I, public
      as $body$
      declare
        v_template bigint;
      begin
        if not public.is_org_staff(%1$L) then
          return;
        end if;

        select a.template_id
          into v_template
          from %1$I.daily_assignments a
         where a.id = p_assignment;

        if v_template is null then
          return;
        end if;

        insert into %1$I.daily_tasks
          (assignment_id, task_name, start_by, finish_by, template_task_id, branch_id, room_id)
        select a.id, t.task_name, t.start_by, t.finish_by, t.id,
               t.branch_id, t.room_id
          from %1$I.daily_assignments a
          join %1$I.template_tasks t on t.template_id = a.template_id
         where a.id = p_assignment
         order by t.sort_order;

        insert into %1$I.daily_task_field_values
          (daily_task_id, field_name, field_value, sort_order)
        select dt.id, f.field_name, coalesce(f.default_value, ''), f.sort_order
          from %1$I.daily_tasks dt
          join %1$I.task_fields f on f.task_id = dt.template_task_id
         where dt.assignment_id = p_assignment
           and not exists (
             select 1
               from %1$I.daily_task_field_values v
              where v.daily_task_id = dt.id
                and v.field_name = f.field_name
           );
      end $body$;
    $fn$, s);

    -- Keep the tenant boundary: authenticated clients only, never service_role directly.
    execute format(
      'grant select, insert, update, delete on %1$I.task_fields, %1$I.daily_task_field_values to authenticated',
      s
    );
    execute format('grant usage, select on all sequences in schema %1$I to authenticated', s);
    execute format('revoke all on %1$I.task_fields, %1$I.daily_task_field_values from service_role', s);
    execute format('revoke all on all sequences in schema %1$I from service_role', s);
    execute format('revoke usage on schema %1$I from service_role', s);
  end loop;
end $migration$;

notify pgrst, 'reload schema';
