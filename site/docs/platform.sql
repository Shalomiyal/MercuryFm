-- Shared types
create type public.user_role   as enum ('platform_admin','org_admin','admin','cleaner');
create type public.room_status as enum ('check_in','check_out','clean_start','clean_finished','ready');
create type public.task_state  as enum ('in_progress','completed');

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  slug          text not null unique check (slug ~ '^[a-z0-9_]{2,30}$'),
  schema_name   text not null unique,
  is_active     boolean not null default true,
  rooms_locked  boolean not null default false,  -- true once rooms have been loaded at least once
  created_at    timestamptz not null default now()
);

-- Minimal auth map for every user. Only platform_admin and org_admin keep
-- their full details here; admin/cleaner details live in org_<slug>.members.
create table public.profiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  org_id    uuid references public.organizations(id),
  role      public.user_role not null default 'cleaner',
  full_name text,
  nic       text,
  must_change_password boolean,
  check ((role = 'platform_admin' and org_id is null)
      or (role <> 'platform_admin' and org_id is not null)),
  check ((role in ('platform_admin','org_admin')
          and full_name is not null and must_change_password is not null)
      or  (role in ('admin','cleaner')
          and full_name is null and nic is null and must_change_password is null))
);

-- Helper functions (used by every RLS policy)
create function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() $$;

create function public.my_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid() $$;

create function public.my_schema() returns text
language sql stable security definer set search_path = public as $$
  select o.schema_name from profiles p join organizations o on o.id = p.org_id
   where p.id = auth.uid() and o.is_active $$;

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'platform_admin', false) $$;

create function public.in_org(s text) returns boolean
language sql stable as $$ select public.my_schema() = s $$;

create function public.is_org_staff(s text) returns boolean   -- org_admin or admin of that org
language sql stable as $$
  select public.my_schema() = s and public.my_role() in ('org_admin','admin') $$;

-- Creates/backfills the tenant user table for one organization.
-- NIC is revoked from direct authenticated SELECT; org staff read it through
-- public.tenant_users() below.
create or replace function public.ensure_tenant_members(p_schema text, p_org_id uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  execute format($t$
    create table if not exists %1$I.members (
      id uuid primary key references auth.users(id) on delete cascade,
      full_name text not null,
      nic text,
      phone text,
      role text not null check (role in ('admin','cleaner')),
      is_active boolean not null default true,
      must_change_password boolean not null default true,
      created_at timestamptz not null default now()
    );
    alter table %1$I.members enable row level security;

    drop policy if exists members_read on %1$I.members;
    create policy members_read on %1$I.members for select using (
      public.in_org(%1$L) and id = auth.uid()
    );

    drop policy if exists members_read_staff on %1$I.members;
    create policy members_read_staff on %1$I.members for select using (
      public.is_org_staff(%1$L)
    );

    drop policy if exists members_manage on %1$I.members;
    create policy members_manage on %1$I.members for all
      using (public.is_org_staff(%1$L))
      with check (public.is_org_staff(%1$L));

    revoke all on %1$I.members from authenticated;
    grant select (id, full_name, role, phone, is_active, must_change_password, created_at),
          insert (id, full_name, role, phone, is_active, must_change_password, created_at),
          update (full_name, role, phone, is_active, must_change_password)
      on %1$I.members to authenticated;
    grant delete on %1$I.members to authenticated;
  $t$, p_schema);

  -- One-time backfill from the old public.profiles details.
  execute format($t$
    insert into %1$I.members
      (id, full_name, nic, phone, role, is_active, must_change_password, created_at)
    select p.id, p.full_name, p.nic, null, p.role::text, true,
           coalesce(p.must_change_password, true), now()
      from public.profiles p
     where p.org_id = %2$L
       and p.role in ('admin','cleaner')
    on conflict (id) do nothing
  $t$, p_schema, p_org_id);
end $fn$;

-- Safe to call repeatedly: upgrades every existing organization.
create or replace function public.sync_tenant_members()
returns void
language plpgsql security definer set search_path = public as $fn$
declare tenant record;
begin
  for tenant in select id, schema_name from public.organizations loop
    perform public.ensure_tenant_members(tenant.schema_name, tenant.id);
  end loop;

  -- Backfilled users no longer need their details in the public map.
  update public.profiles
     set full_name = null, nic = null, must_change_password = null
   where role in ('admin','cleaner')
     and exists (select 1 from auth.users u where u.id = public.profiles.id);
end $fn$;

-- Own tenant details (no NIC) for the logged-in admin/cleaner.
create or replace function public.my_tenant_user()
returns table (
  id uuid, full_name text, phone text, role text,
  is_active boolean, must_change_password boolean
)
language plpgsql security definer set search_path = public as $fn$
declare s text;
begin
  s := public.my_schema();
  if s is null then return; end if;
  return query execute format(
    'select id, full_name, phone, role, is_active, must_change_password from %I.members where id = auth.uid()',
    s
  );
end $fn$;

-- Org staff list, including NIC. Non-staff get an exception.
create or replace function public.tenant_users(p_schema text)
returns table (
  id uuid, full_name text, nic text, phone text, role text,
  is_active boolean, must_change_password boolean, created_at timestamptz
)
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_org_staff(p_schema) then
    raise exception 'Organization staff access required';
  end if;
  return query execute format($q$
    select m.id, m.full_name, m.nic, m.phone, m.role,
           m.is_active, m.must_change_password, m.created_at
      from %1$I.members m
     union all
    select p.id, p.full_name, p.nic, null::text, p.role::text,
           true, p.must_change_password, now()
      from public.profiles p
      join public.organizations o on o.id = p.org_id
     where o.schema_name = %1$L and p.role = 'org_admin'
     order by 2
  $q$, p_schema);
end $fn$;

-- Keeps the public map and tenant user record in sync after first password change.
create or replace function public.mark_password_changed()
returns void
language plpgsql security definer set search_path = public as $fn$
declare s text;
begin
  select o.schema_name into s
    from public.profiles p
    join public.organizations o on o.id = p.org_id
   where p.id = auth.uid();

  update public.profiles
     set must_change_password = false
   where id = auth.uid();

  if s is not null then
    execute format('update %I.members set must_change_password = false where id = auth.uid()', s);
  end if;
end $fn$;

-- Service-side organization user list (no NIC) for login options.
create or replace function public.list_organization_users(p_org_id uuid)
returns table (id uuid, full_name text, role text, phone text)
language plpgsql security definer set search_path = public as $fn$
declare s text;
begin
  select o.schema_name into s from public.organizations o where o.id = p_org_id;
  if s is null then return; end if;
  return query execute format($q$
    select m.id, m.full_name, m.role, m.phone from %1$I.members m
     union all
    select p.id, p.full_name, p.role::text, null::text
      from public.profiles p
     where p.org_id = %2$L and p.role = 'org_admin'
     order by 2
  $q$, s, p_org_id);
end $fn$;

-- Inserts a tenant user row without granting service_role access to the
-- tenant schema. All three writes (auth user, public map, tenant row) are
-- rolled back by the API if any step fails.
create or replace function public.insert_tenant_user(
  p_org_id uuid, p_id uuid, p_full_name text, p_nic text,
  p_phone text, p_role text,
  p_must_change_password boolean default true
)
returns void
language plpgsql security definer set search_path = public as $fn$
declare s text;
begin
  if p_role not in ('admin','cleaner') then
    raise exception 'Tenant members must be admin or cleaner';
  end if;
  select o.schema_name into s from public.organizations o where o.id = p_org_id;
  if s is null then raise exception 'Organization not found'; end if;
  execute format($q$
    insert into %1$I.members
      (id, full_name, nic, phone, role, is_active, must_change_password)
    values ($1, $2, $3, $4, $5, true, $6)
  $q$, s) using p_id, p_full_name, p_nic, p_phone, p_role, p_must_change_password;
end $fn$;

-- Admin user management: role changes, NIC lookup for password resets, and
-- clearing the forced-password-change flag. All are service-role only.
create or replace function public.update_tenant_user_role(
  p_org_id uuid, p_user_id uuid, p_role text
)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  s text;
  updated_count integer;
begin
  if p_role not in ('admin','cleaner') then
    raise exception 'Role must be admin or cleaner';
  end if;
  select o.schema_name into s from public.organizations o where o.id = p_org_id;
  if s is null then raise exception 'Organization not found'; end if;
  execute format('update %I.members set role = $1 where id = $2', s)
    using p_role, p_user_id;
  get diagnostics updated_count = row_count;
  if updated_count = 0 then raise exception 'Tenant user not found'; end if;
end $fn$;

create or replace function public.get_tenant_user_nic(
  p_org_id uuid, p_user_id uuid
)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  s text;
  nic_value text;
begin
  select o.schema_name into s from public.organizations o where o.id = p_org_id;
  if s is null then raise exception 'Organization not found'; end if;
  execute format('select nic from %I.members where id = $1', s)
    into nic_value using p_user_id;
  return nic_value;
end $fn$;

create or replace function public.set_tenant_user_must_change_password(
  p_org_id uuid, p_user_id uuid, p_must_change_password boolean
)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  s text;
  updated_count integer;
begin
  select o.schema_name into s from public.organizations o where o.id = p_org_id;
  if s is null then raise exception 'Organization not found'; end if;
  execute format('update %I.members set must_change_password = $1 where id = $2', s)
    using p_must_change_password, p_user_id;
  get diagnostics updated_count = row_count;
  if updated_count = 0 then raise exception 'Tenant user not found'; end if;
end $fn$;

-- Room reads/writes go through public security-definer RPCs, so service_role
-- never needs privileges inside tenant schemas.
create or replace function public.list_organization_rooms(p_org_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare s text; result jsonb;
begin
  select o.schema_name into s from public.organizations o where o.id = p_org_id;
  if s is null then raise exception 'Organization not found'; end if;

  execute format($q$
    select jsonb_build_object(
      'roomsLocked', (select rooms_locked from public.organizations where id = %2$L),
      'branches', coalesce((
        select jsonb_agg(jsonb_build_object('branch_id', branch_id) order by branch_id)
          from %1$I.branches), '[]'::jsonb),
      'rooms', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'room_id', room_id,
                 'branch_id', branch_id,
                 'current_status', current_status
               ) order by branch_id, room_id)
          from %1$I.rooms), '[]'::jsonb)
    )
  $q$, s, p_org_id) into result;
  return result;
end $fn$;

create or replace function public.save_organization_rooms(p_org_id uuid, p_rooms jsonb)
returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  s text;
  room_ids text[];
  branch_ids text[];
begin
  select o.schema_name into s from public.organizations o where o.id = p_org_id;
  if s is null then raise exception 'Organization not found'; end if;

  select array_agg(distinct value->>'room_id'),
         array_agg(distinct value->>'branch_id')
    into room_ids, branch_ids
    from jsonb_array_elements(p_rooms);
  room_ids := coalesce(room_ids, '{}');
  branch_ids := coalesce(branch_ids, '{}');

  execute format('delete from %1$I.rooms where room_id <> all($1::text[])', s)
    using room_ids;
  execute format('delete from %1$I.branches where branch_id <> all($1::text[])', s)
    using branch_ids;

  execute format(
    'insert into %1$I.branches (branch_id) select unnest($1::text[]) on conflict (branch_id) do nothing',
    s
  ) using branch_ids;

  execute format($q$
    insert into %1$I.rooms (room_id, branch_id)
    select value->>'room_id', value->>'branch_id'
      from jsonb_array_elements($1)
    on conflict (room_id) do update set branch_id = excluded.branch_id
  $q$, s) using p_rooms;

  update public.organizations set rooms_locked = true where id = p_org_id;
  return jsonb_array_length(p_rooms);
end $fn$;

alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;

create policy "platform admin all orgs" on public.organizations for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "see own org" on public.organizations for select
  using (id = public.my_org_id());

create policy "platform admin all profiles" on public.profiles for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "read profiles in my org" on public.profiles for select
  using (id = auth.uid() or org_id = public.my_org_id());
create policy "update own password state" on public.profiles for update
  using (id = auth.uid() and public.my_role() in ('platform_admin','org_admin'))
  with check (id = auth.uid() and public.my_role() in ('platform_admin','org_admin'));

-- Tell the API which schemas to expose (keeps the list in sync)
create function public.refresh_exposed_schemas() returns void
language plpgsql security definer set search_path = public as $$
declare lst text;
begin
  select 'public,graphql_public' || coalesce(',' || string_agg(schema_name, ',' order by schema_name), '')
    into lst from organizations where is_active;
  execute format('alter role authenticator set pgrst.db_schemas = %L', lst);
  notify pgrst, 'reload config';
  notify pgrst, 'reload schema';
end $$;

-- PROVISIONING: creates the whole table package for one organization
create function public.provision_organization(p_name text, p_slug text)
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
    -- Tenant user details are stored here, never in the public map for
    -- admin/cleaner accounts.
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
      task_name text not null,
      start_by time,
      finish_by time not null,
      sort_order int not null default 0
    );
    create table %1$I.task_fields (
      id bigint generated always as identity primary key,
      task_id bigint not null references %1$I.template_tasks(id) on delete cascade,
      field_name text not null,
      default_value text,
      sort_order int not null default 0,
      unique (task_id, field_name)
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
      task_name text not null,
      start_by time,
      finish_by time not null,
      template_task_id bigint references %1$I.template_tasks(id) on delete set null
    );
    create table %1$I.daily_task_field_values (
      id bigint generated always as identity primary key,
      daily_task_id bigint not null references %1$I.daily_tasks(id) on delete cascade,
      field_name text not null,
      field_value text,
      sort_order int not null default 0,
      unique (daily_task_id, field_name)
    );

    create function %1$I.load_template_tasks(p_assignment bigint) returns void
    language plpgsql security definer set search_path = %1$I, public as $b$
    declare
      v_template bigint;
    begin
      if not public.is_org_staff(%1$L) then
        return;
      end if;

      select a.template_id into v_template
        from %1$I.daily_assignments a
       where a.id = p_assignment;

      if v_template is null then
        return;
      end if;

      insert into %1$I.daily_tasks
        (assignment_id, task_name, start_by, finish_by, template_task_id)
      select a.id, t.task_name, t.start_by, t.finish_by, t.id
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
    end $b$;

    -- Photos and videos stored in the database (metadata + chunks)
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

    -- RLS
    alter table %1$I.members               enable row level security;
    alter table %1$I.branches            enable row level security;
    alter table %1$I.rooms               enable row level security;
    alter table %1$I.room_status_history enable row level security;
    alter table %1$I.task_templates      enable row level security;
    alter table %1$I.template_tasks      enable row level security;
    alter table %1$I.task_fields         enable row level security;
    alter table %1$I.daily_assignments   enable row level security;
    alter table %1$I.daily_tasks         enable row level security;
    alter table %1$I.daily_task_field_values enable row level security;
    alter table %1$I.task_runs           enable row level security;
    alter table %1$I.media               enable row level security;
    alter table %1$I.media_chunks        enable row level security;

    -- member policies are installed by ensure_tenant_members() below.
    create policy read_branches on %1$I.branches for select using (public.in_org(%1$L));
    create policy read_rooms    on %1$I.rooms    for select using (public.in_org(%1$L));

    create policy hist_read  on %1$I.room_status_history for select using (public.is_org_staff(%1$L));
    create policy hist_write on %1$I.room_status_history for insert with check (public.is_org_staff(%1$L));

    create policy tpl_all   on %1$I.task_templates    for all using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy tpt_all   on %1$I.template_tasks    for all using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy tf_all    on %1$I.task_fields       for all using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy asg_all   on %1$I.daily_assignments for all using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy dt_all    on %1$I.daily_tasks       for all using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy dtfv_staff on %1$I.daily_task_field_values for all using (public.is_org_staff(%1$L)) with check (public.is_org_staff(%1$L));
    create policy asg_own   on %1$I.daily_assignments for select using (public.in_org(%1$L) and cleaner_id = auth.uid());
    create policy dt_own    on %1$I.daily_tasks for select using (
      public.in_org(%1$L) and exists (select 1 from %1$I.daily_assignments a
        where a.id = assignment_id and a.cleaner_id = auth.uid()));
    create policy dtfv_own_select on %1$I.daily_task_field_values for select using (
      public.in_org(%1$L) and exists (
        select 1 from %1$I.daily_tasks dt
        join %1$I.daily_assignments a on a.id = dt.assignment_id
        where dt.id = daily_task_id and a.cleaner_id = auth.uid()
      ));
    create policy dtfv_own_update on %1$I.daily_task_field_values for update
      using (
        public.in_org(%1$L) and exists (
          select 1 from %1$I.daily_tasks dt
          join %1$I.daily_assignments a on a.id = dt.assignment_id
          where dt.id = daily_task_id and a.cleaner_id = auth.uid()
        ))
      with check (
        public.in_org(%1$L) and exists (
          select 1 from %1$I.daily_tasks dt
          join %1$I.daily_assignments a on a.id = dt.assignment_id
          where dt.id = daily_task_id and a.cleaner_id = auth.uid()
        ));

    create policy runs_staff on %1$I.task_runs for select using (public.is_org_staff(%1$L));
    create policy runs_own   on %1$I.task_runs for all
      using (public.in_org(%1$L) and cleaner_id = auth.uid())
      with check (public.in_org(%1$L) and cleaner_id = auth.uid());

    create policy media_staff on %1$I.media for select using (public.is_org_staff(%1$L));
    create policy media_own   on %1$I.media for select using (public.in_org(%1$L) and created_by = auth.uid());

    -- Grants: authenticated only. service_role is deliberately not granted
    -- anything inside tenant schemas; room access uses public RPCs instead.
    grant usage on schema %1$I to authenticated;
    grant select, insert, update, delete on all tables in schema %1$I to authenticated;
    -- NIC must never be directly readable by authenticated clients.
    revoke select on %1$I.members from authenticated;
    grant select (id, full_name, role, phone, is_active, must_change_password, created_at) on %1$I.members to authenticated;
    grant usage, select on all sequences in schema %1$I to authenticated;
    revoke all on %1$I.media_chunks from authenticated;  -- blobs only through the server API
    -- Tenant tables are never accessed directly by service_role.
    revoke all on all tables in schema %1$I from service_role;
    revoke all on all sequences in schema %1$I from service_role;
    revoke usage on schema %1$I from service_role;
  $t$, s);

  perform public.ensure_tenant_members(s, oid);
  perform public.refresh_exposed_schemas();
  return oid;
end $fn$;

-- Only the intended roles may call these functions.
revoke all on function public.provision_organization(text,text)        from public, anon, authenticated;
revoke all on function public.refresh_exposed_schemas()                 from public, anon, authenticated;
revoke all on function public.ensure_tenant_members(text,uuid)            from public, anon, authenticated;
revoke all on function public.sync_tenant_members()                       from public, anon, authenticated;
revoke all on function public.list_organization_users(uuid)                    from public, anon, authenticated;
revoke all on function public.insert_tenant_user(uuid,uuid,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.update_tenant_user_role(uuid,uuid,text)   from public, anon, authenticated;
revoke all on function public.get_tenant_user_nic(uuid,uuid)            from public, anon, authenticated;
revoke all on function public.set_tenant_user_must_change_password(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.list_organization_rooms(uuid)             from public, anon, authenticated;
revoke all on function public.save_organization_rooms(uuid,jsonb)       from public, anon, authenticated;
revoke all on function public.tenant_users(text)                        from public, anon;
revoke all on function public.my_tenant_user()                          from public, anon;
revoke all on function public.mark_password_changed()                   from public, anon;

grant execute on function public.list_organization_users(uuid),
                           public.insert_tenant_user(uuid,uuid,text,text,text,text,boolean),
                           public.update_tenant_user_role(uuid,uuid,text),
                           public.get_tenant_user_nic(uuid,uuid),
                           public.set_tenant_user_must_change_password(uuid,uuid,boolean),
                           public.list_organization_rooms(uuid),
                           public.save_organization_rooms(uuid,jsonb) to service_role;
grant execute on function public.tenant_users(text),
                           public.my_tenant_user(),
                           public.mark_password_changed() to authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.organizations to service_role;
grant select on public.organizations, public.profiles to authenticated;
