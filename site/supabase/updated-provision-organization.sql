-- Updated provisioning function. Run supabase/tenant-users-migration.sql first
-- so the helper functions exist, then run this file once.
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
    create table %1$I.members (
      id uuid primary key references auth.users(id) on delete cascade,
      full_name text not null,
      nic text,
      phone text,
      role text not null check (role in ('admin','cleaner')),
      is_active boolean not null default true,
      must_change_password boolean not null default true,
      created_at timestamptz not null default now()
    );

    create table %1$I.branches (branch_id text primary key);

    create table %1$I.rooms (
      room_id        text primary key,
      branch_id      text not null references %1$I.branches(branch_id),
      current_status public.room_status,
      status_time    timestamptz,
      updated_at     timestamptz default now()
    );

    create table %1$I.room_status_history (
      id          bigint generated always as identity primary key,
      room_id     text not null references %1$I.rooms(room_id),
      status      public.room_status not null,
      status_time timestamptz not null,
      created_at  timestamptz not null default now(),
      created_by  uuid references public.profiles(id) on delete set null
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

    create table %1$I.task_templates (
      id bigint generated always as identity primary key,
      name text not null unique, description text,
      created_at timestamptz not null default now()
    );
    create table %1$I.template_tasks (
      id bigint generated always as identity primary key,
      template_id bigint not null references %1$I.task_templates(id) on delete cascade,
      task_name text not null, finish_by time not null, sort_order int not null default 0
    );
    create table %1$I.daily_assignments (
      id bigint generated always as identity primary key,
      work_date date not null,
      template_id bigint references %1$I.task_templates(id) on delete set null,
      cleaner_id uuid not null references %1$I.members(id),
      unique (work_date, cleaner_id, template_id)
    );
    create table %1$I.daily_tasks (
      id bigint generated always as identity primary key,
      assignment_id bigint not null references %1$I.daily_assignments(id) on delete cascade,
      task_name text not null, finish_by time not null
    );

    create function %1$I.load_template_tasks(p_assignment bigint) returns void
    language sql security definer as $b$
      insert into %1$I.daily_tasks (assignment_id, task_name, finish_by)
      select a.id, t.task_name, t.finish_by
        from %1$I.daily_assignments a
        join %1$I.template_tasks t on t.template_id = a.template_id
       where a.id = p_assignment and public.is_org_staff(%1$L)
       order by t.sort_order;
    $b$;

    create table %1$I.media (
      id          uuid primary key default gen_random_uuid(),
      kind        text not null check (kind in ('photo','video')),
      mime_type   text not null,
      size_bytes  int  not null,
      chunk_count int  not null,
      complete    boolean not null default false,
      created_by  uuid references %1$I.members(id),
      created_at  timestamptz not null default now()
    );
    create table %1$I.media_chunks (
      media_id    uuid not null references %1$I.media(id) on delete cascade,
      chunk_index int  not null,
      data        bytea not null,
      primary key (media_id, chunk_index)
    );

    create table %1$I.task_runs (
      id             bigint generated always as identity primary key,
      daily_task_id  bigint not null references %1$I.daily_tasks(id) on delete cascade,
      run_date       date not null default current_date,
      cleaner_id     uuid not null references %1$I.members(id),
      started_at     timestamptz,
      start_photo_id uuid references %1$I.media(id),
      finished_at    timestamptz,
      finish_video_id uuid references %1$I.media(id),
      state          public.task_state not null default 'in_progress',
      unique (daily_task_id)
    );

    alter table %1$I.members               enable row level security;
    alter table %1$I.branches            enable row level security;
    alter table %1$I.rooms               enable row level security;
    alter table %1$I.room_status_history enable row level security;
    alter table %1$I.task_templates      enable row level security;
    alter table %1$I.template_tasks      enable row level security;
    alter table %1$I.daily_assignments   enable row level security;
    alter table %1$I.daily_tasks         enable row level security;
    alter table %1$I.task_runs           enable row level security;
    alter table %1$I.media               enable row level security;
    alter table %1$I.media_chunks        enable row level security;

    create policy read_branches on %1$I.branches for select using (public.in_org(%1$L));
    create policy read_rooms    on %1$I.rooms    for select using (public.in_org(%1$L));

    create policy hist_read  on %1$I.room_status_history for select using (public.is_org_staff(%1$L));
    create policy hist_write on %1$I.room_status_history for insert with check (public.is_org_staff(%1$L));

    create policy tpl_all   on %1$I.task_templates    for all using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy tpt_all   on %1$I.template_tasks    for all using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy asg_all   on %1$I.daily_assignments for all using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy dt_all    on %1$I.daily_tasks       for all using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy asg_own   on %1$I.daily_assignments for select using (public.in_org(%1$L) and cleaner_id = auth.uid());
    create policy dt_own    on %1$I.daily_tasks for select using (
      public.in_org(%1$L) and exists (select 1 from %1$I.daily_assignments a
        where a.id = assignment_id and a.cleaner_id = auth.uid()));

    create policy runs_staff on %1$I.task_runs for select using (public.is_org_staff(%1$L));
    create policy runs_own   on %1$I.task_runs for all
      using (public.in_org(%1$L) and cleaner_id = auth.uid())
      with check (public.in_org(%1$L) and cleaner_id = auth.uid());

    create policy media_staff on %1$I.media for select using (public.is_org_staff(%1$L));
    create policy media_own   on %1$I.media for select using (public.in_org(%1$L) and created_by = auth.uid());

    grant usage on schema %1$I to authenticated;
    grant select, insert, update, delete on all tables in schema %1$I to authenticated;
    -- NIC must never be directly readable by authenticated clients.
    revoke select on %1$I.members from authenticated;
    grant select (id, full_name, role, phone, is_active, must_change_password, created_at) on %1$I.members to authenticated;
    grant usage, select on all sequences in schema %1$I to authenticated;
    revoke all on %1$I.media_chunks from authenticated;
  $t$, s);

  perform public.ensure_tenant_members(s, oid);
  perform public.refresh_exposed_schemas();
  return oid;
end $fn$;

revoke all on function public.provision_organization(text,text) from public, anon, authenticated;
notify pgrst, 'reload schema';
