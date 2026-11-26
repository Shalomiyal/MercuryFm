-- ============================================================================
-- Mercury FM — Complete provision_organization function
-- Includes ALL migrations applied since launch:
--   • task_fields table, start_by times, template_task_id, daily_task_field_values
--   • load_template_tasks copies fields + branch/room
--   • room_status_history.media_id column
--   • hist_write allows cleaners to insert clean_start / clean_finished
--   • sync_task_run_to_room_status trigger (auto-status from task runs)
--   • media_insert_own allows created_by IS NULL
--   • service_role gets USAGE + targeted grants on tenant schemas
--   • assign_template_tasks public RPC
-- Safe to run on a fresh DB or after a full reset.
-- ============================================================================

create or replace function public.provision_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  s   text := 'org_' || p_slug;
  oid uuid;
begin
  if p_slug !~ '^[a-z0-9_]{2,30}$' then
    raise exception 'Slug must be 2-30 chars: a-z, 0-9, underscore';
  end if;

  insert into organizations (name, slug, schema_name)
  values (p_name, p_slug, s) returning id into oid;

  execute format('create schema %I', s);

  execute format($t$

    -- ── Members ───────────────────────────────────────────────────────────
    create table %1$I.members (
      id                  uuid primary key references auth.users(id) on delete cascade,
      full_name           text not null,
      nic                 text,
      phone               text,
      role                text not null check (role in ('admin','cleaner')),
      is_active           boolean not null default true,
      must_change_password boolean not null default true,
      created_at          timestamptz not null default now()
    );

    -- ── Branches & Rooms ──────────────────────────────────────────────────
    create table %1$I.branches (branch_id text primary key);

    create table %1$I.rooms (
      room_id        text primary key,
      branch_id      text not null references %1$I.branches(branch_id),
      current_status public.room_status,
      status_time    timestamptz,
      updated_at     timestamptz default now()
    );

    -- ── Room Status History ───────────────────────────────────────────────
    create table %1$I.room_status_history (
      id          bigint generated always as identity primary key,
      room_id     text not null references %1$I.rooms(room_id),
      status      public.room_status not null,
      status_time timestamptz not null,
      created_at  timestamptz not null default now(),
      created_by  uuid references public.profiles(id) on delete set null,
      media_id    uuid   -- FK added after media table; see deferred FK below
    );
    create index on %1$I.room_status_history (room_id, created_at desc);

    create function %1$I.sync_room_status() returns trigger
    language plpgsql security definer as $b$
    begin
      update %1$I.rooms
         set current_status = new.status, status_time = new.status_time, updated_at = now()
       where room_id = new.room_id;
      return new;
    end $b$;
    create trigger trg_sync_room_status after insert on %1$I.room_status_history
      for each row execute function %1$I.sync_room_status();

    -- ── Templates ─────────────────────────────────────────────────────────
    create table %1$I.task_templates (
      id          bigint generated always as identity primary key,
      name        text not null unique,
      description text,
      created_at  timestamptz not null default now()
    );

    create table %1$I.template_tasks (
      id          bigint generated always as identity primary key,
      template_id bigint not null references %1$I.task_templates(id) on delete cascade,
      task_name   text not null,
      start_by    time,
      finish_by   time not null,
      sort_order  int  not null default 0
    );

    create table %1$I.task_fields (
      id            bigint generated always as identity primary key,
      task_id       bigint not null references %1$I.template_tasks(id) on delete cascade,
      field_name    text not null,
      default_value text,
      sort_order    int  not null default 0,
      unique (task_id, field_name)
    );

    -- ── Assignments & Daily Tasks ─────────────────────────────────────────
    create table %1$I.daily_assignments (
      id          bigint generated always as identity primary key,
      work_date   date not null,
      template_id bigint references %1$I.task_templates(id) on delete set null,
      cleaner_id  uuid not null references %1$I.members(id),
      unique (work_date, cleaner_id, template_id)
    );

    create table %1$I.daily_tasks (
      id               bigint generated always as identity primary key,
      assignment_id    bigint not null references %1$I.daily_assignments(id) on delete cascade,
      task_name        text not null,
      start_by         time,
      finish_by        time not null,
      template_task_id bigint references %1$I.template_tasks(id) on delete set null,
      branch_id        text,
      room_id          text
    );

    create table %1$I.daily_task_field_values (
      id            bigint generated always as identity primary key,
      daily_task_id bigint not null references %1$I.daily_tasks(id) on delete cascade,
      field_name    text not null,
      field_value   text,
      sort_order    int  not null default 0,
      unique (daily_task_id, field_name)
    );

    -- ── load_template_tasks — copies tasks + field values + branch/room ───
    create function %1$I.load_template_tasks(p_assignment bigint) returns void
    language plpgsql security definer set search_path = %1$I, public as $b$
    declare v_template bigint;
    begin
      if not public.is_org_staff(%1$L) then return; end if;

      select a.template_id into v_template
        from %1$I.daily_assignments a where a.id = p_assignment;
      if v_template is null then return; end if;

      insert into %1$I.daily_tasks
        (assignment_id, task_name, start_by, finish_by, template_task_id, branch_id, room_id)
      select a.id, t.task_name, t.start_by, t.finish_by, t.id, null, null
        from %1$I.daily_assignments a
        join %1$I.template_tasks t on t.template_id = a.template_id
       where a.id = p_assignment
       order by t.sort_order;

      insert into %1$I.daily_task_field_values
        (daily_task_id, field_name, field_value, sort_order)
      select dt.id, f.field_name, coalesce(f.default_value,''), f.sort_order
        from %1$I.daily_tasks dt
        join %1$I.task_fields f on f.task_id = dt.template_task_id
       where dt.assignment_id = p_assignment
         and not exists (
           select 1 from %1$I.daily_task_field_values v
            where v.daily_task_id = dt.id and v.field_name = f.field_name
         );
    end $b$;

    -- ── Media ─────────────────────────────────────────────────────────────
    create table %1$I.media (
      id               uuid primary key default gen_random_uuid(),
      kind             text not null check (kind in ('photo','video')),
      mime_type        text not null,
      size_bytes       int  not null,
      chunk_count      int  default 0,
      bucket           text default 'work-media',
      storage_path     text unique,
      thumb_path       text,
      duration_seconds numeric,
      width            int,
      height           int,
      complete         boolean not null default false,
      created_by       uuid references %1$I.members(id),
      created_at       timestamptz not null default now(),
      constraint media_storage_or_chunks_check check (storage_path is not null or chunk_count > 0)
    );
    create table %1$I.media_chunks (
      media_id    uuid not null references %1$I.media(id) on delete cascade,
      chunk_index int  not null,
      data        bytea not null,
      primary key (media_id, chunk_index)
    );

    -- Back-fill media_id FK on room_status_history now that media table exists
    alter table %1$I.room_status_history
      add constraint room_status_history_media_id_fkey
      foreign key (media_id) references %1$I.media(id) on delete set null;

    -- ── Task Runs ─────────────────────────────────────────────────────────
    create table %1$I.task_runs (
      id              bigint generated always as identity primary key,
      daily_task_id   bigint not null references %1$I.daily_tasks(id) on delete cascade,
      run_date        date not null default current_date,
      cleaner_id      uuid not null references %1$I.members(id),
      branch_id       text,
      room_id         text,
      started_at      timestamptz,
      start_photo_id  uuid references %1$I.media(id),
      finished_at     timestamptz,
      finish_video_id uuid references %1$I.media(id),
      state           public.task_state not null default 'in_progress',
      unique (daily_task_id)
    );
    create index task_runs_run_date_cleaner_idx on %1$I.task_runs (run_date, cleaner_id);
    create index task_runs_started_at_idx       on %1$I.task_runs (started_at desc);

    -- ── Auto-sync task runs → room_status_history ─────────────────────────
    create function %1$I.sync_task_run_to_room_status() returns trigger
    language plpgsql security definer as $b$
    declare v_room text;
    begin
      v_room := coalesce(
        new.room_id,
        (select dt.room_id from %1$I.daily_tasks dt where dt.id = new.daily_task_id)
      );
      if v_room is null or v_room = '' then return new; end if;

      if tg_op = 'INSERT' and new.state = 'in_progress' then
        insert into %1$I.room_status_history (room_id, status, status_time, created_by)
        values (v_room, 'clean_start', coalesce(new.started_at, now()), new.cleaner_id)
        on conflict do nothing;
      elsif tg_op = 'UPDATE' and new.state = 'completed' and old.state is distinct from 'completed' then
        insert into %1$I.room_status_history (room_id, status, status_time, created_by)
        values (v_room, 'clean_finished', coalesce(new.finished_at, now()), new.cleaner_id)
        on conflict do nothing;
      end if;
      return new;
    end $b$;
    create trigger trg_task_run_room_status
      after insert or update on %1$I.task_runs
      for each row execute function %1$I.sync_task_run_to_room_status();

    -- ── RLS ───────────────────────────────────────────────────────────────
    alter table %1$I.members                 enable row level security;
    alter table %1$I.branches                enable row level security;
    alter table %1$I.rooms                   enable row level security;
    alter table %1$I.room_status_history     enable row level security;
    alter table %1$I.task_templates          enable row level security;
    alter table %1$I.template_tasks          enable row level security;
    alter table %1$I.task_fields             enable row level security;
    alter table %1$I.daily_assignments       enable row level security;
    alter table %1$I.daily_tasks             enable row level security;
    alter table %1$I.daily_task_field_values enable row level security;
    alter table %1$I.task_runs               enable row level security;
    alter table %1$I.media                   enable row level security;
    alter table %1$I.media_chunks            enable row level security;

    -- Members
    create policy members_read on %1$I.members for select using (
      public.in_org(%1$L) and (id = auth.uid() or public.is_org_staff(%1$L))
    );
    create policy members_manage on %1$I.members for all
      using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));

    -- Branches / rooms
    create policy read_branches on %1$I.branches for select using (public.in_org(%1$L));
    create policy read_rooms    on %1$I.rooms    for select using (public.in_org(%1$L));

    -- Room status: staff manage; cleaners can insert clean_start/clean_finished
    create policy hist_read  on %1$I.room_status_history for select
      using (public.is_org_staff(%1$L));
    create policy hist_write on %1$I.room_status_history for insert
      with check (
        public.is_org_staff(%1$L)
        or (public.in_org(%1$L) and status in ('clean_start','clean_finished'))
      );

    -- Templates & task fields
    create policy tpl_all on %1$I.task_templates for all
      using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy tpt_all on %1$I.template_tasks for all
      using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy tf_all  on %1$I.task_fields    for all
      using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));

    -- Assignments & daily tasks
    create policy asg_all on %1$I.daily_assignments for all
      using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy dt_all  on %1$I.daily_tasks       for all
      using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy dtfv_staff on %1$I.daily_task_field_values for all
      using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));

    create policy asg_own on %1$I.daily_assignments for select
      using (public.in_org(%1$L) and cleaner_id = auth.uid());
    create policy dt_own  on %1$I.daily_tasks for select using (
      public.in_org(%1$L) and exists (
        select 1 from %1$I.daily_assignments a
         where a.id = assignment_id and a.cleaner_id = auth.uid()
      ));
    create policy dtfv_own_select on %1$I.daily_task_field_values for select using (
      public.in_org(%1$L) and exists (
        select 1 from %1$I.daily_tasks dt
        join %1$I.daily_assignments a on a.id = dt.assignment_id
         where dt.id = daily_task_id and a.cleaner_id = auth.uid()
      ));
    create policy dtfv_own_update on %1$I.daily_task_field_values for update
      using (public.in_org(%1$L) and exists (
        select 1 from %1$I.daily_tasks dt
        join %1$I.daily_assignments a on a.id = dt.assignment_id
         where dt.id = daily_task_id and a.cleaner_id = auth.uid()
      ))
      with check (public.in_org(%1$L) and exists (
        select 1 from %1$I.daily_tasks dt
        join %1$I.daily_assignments a on a.id = dt.assignment_id
         where dt.id = daily_task_id and a.cleaner_id = auth.uid()
      ));

    -- Task runs
    create policy runs_staff on %1$I.task_runs for select using (public.is_org_staff(%1$L));
    create policy runs_own   on %1$I.task_runs for all
      using  (public.in_org(%1$L) and cleaner_id = auth.uid())
      with check (public.in_org(%1$L) and cleaner_id = auth.uid());

    -- Media: staff can read all; owners can read + insert their own or null created_by
    create policy media_staff      on %1$I.media for select using (public.is_org_staff(%1$L));
    create policy media_own        on %1$I.media for select
      using (public.in_org(%1$L) and created_by = auth.uid());
    create policy media_insert_own on %1$I.media for insert
      with check (public.in_org(%1$L) and (created_by = auth.uid() or created_by is null));

    -- ── Grants: authenticated ─────────────────────────────────────────────
    grant usage on schema %1$I to authenticated;
    grant select, insert, update, delete on all tables in schema %1$I to authenticated;
    revoke select on %1$I.members from authenticated;
    grant select (id, full_name, role, phone, is_active, must_change_password, created_at),
          insert (id, full_name, role, phone, is_active, must_change_password, created_at),
          update (full_name, role, phone, is_active, must_change_password)
      on %1$I.members to authenticated;
    grant delete on %1$I.members to authenticated;
    grant usage, select on all sequences in schema %1$I to authenticated;
    revoke all on %1$I.media_chunks from authenticated;

    -- ── Grants: service_role (needed for server API routes) ───────────────
    grant usage on schema %1$I to service_role;
    grant select, insert, update on %1$I.room_status_history to service_role;
    grant select, insert          on %1$I.media               to service_role;
    grant select                  on %1$I.rooms                to service_role;
    grant select                  on %1$I.branches             to service_role;
    grant select                  on %1$I.members              to service_role;
    grant select                  on %1$I.daily_tasks          to service_role;
    grant select                  on %1$I.daily_assignments    to service_role;
    grant select                  on %1$I.task_runs            to service_role;
    grant select                  on %1$I.task_templates       to service_role;
    grant select                  on %1$I.template_tasks       to service_role;

  $t$, s);

  perform public.ensure_tenant_members(s, oid);
  perform public.apply_work_media_to_schema(s);
  perform public.refresh_exposed_schemas();
  return oid;
end $fn$;

revoke all on function public.provision_organization(text,text) from public, anon, authenticated;
notify pgrst, 'reload schema';
