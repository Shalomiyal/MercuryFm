-- Run once in the Supabase SQL Editor for the Mercury FM project.
-- Installs the tenant RPC layer that is missing from plzsxjiimgdcluaedxrp.
-- Safe to re-run. Does not touch the sign-language tables.

-- ---------------------------------------------------------------------------
-- 1. public.profiles stays a minimal auth map
-- ---------------------------------------------------------------------------
alter table public.profiles alter column full_name drop not null;
alter table public.profiles alter column must_change_password drop not null;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (
  (role = 'platform_admin' and org_id is null)
  or (role <> 'platform_admin' and org_id is not null)
);

alter table public.profiles drop constraint if exists profiles_admin_details_check;
alter table public.profiles add constraint profiles_admin_details_check check (
  (role in ('platform_admin','org_admin')
   and full_name is not null and must_change_password is not null)
  or (role in ('admin','cleaner')
   and full_name is null and nic is null and must_change_password is null)
);

-- ---------------------------------------------------------------------------
-- 2. Tenant members table helper (per org_<slug> schema)
-- ---------------------------------------------------------------------------
create or replace function public.ensure_tenant_members(p_schema text, p_org_id uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = p_schema) then
    raise notice 'Schema % does not exist yet; skipping members setup', p_schema;
    return;
  end if;

  execute format($t$
    grant usage on schema %1$I to authenticated;

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

    alter table %1$I.members add column if not exists nic text;
    alter table %1$I.members add column if not exists phone text;
    alter table %1$I.members add column if not exists is_active boolean not null default true;
    alter table %1$I.members add column if not exists must_change_password boolean not null default true;
    alter table %1$I.members add column if not exists created_at timestamptz not null default now();

    alter table %1$I.members enable row level security;

    drop policy if exists members_read on %1$I.members;
    drop policy if exists members_read_staff on %1$I.members;
    create policy members_read on %1$I.members for select using (
      public.in_org(%1$L)
      and (id = auth.uid() or public.is_org_staff(%1$L))
    );

    drop policy if exists members_manage on %1$I.members;
    create policy members_manage on %1$I.members for all
      using (public.is_org_staff(%1$L))
      with check (public.is_org_staff(%1$L));

    -- NIC is never directly readable by authenticated clients.
    revoke all on %1$I.members from authenticated;
    grant select (id, full_name, role, phone, is_active, must_change_password, created_at),
          insert (id, full_name, role, phone, is_active, must_change_password, created_at),
          update (full_name, role, phone, is_active, must_change_password)
      on %1$I.members to authenticated;
    grant delete on %1$I.members to authenticated;
  $t$, p_schema);

  -- Backfill admin/cleaner details from the old public map, if any.
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

-- Applies the helper to every existing organization whose schema exists.
create or replace function public.sync_tenant_members()
returns void
language plpgsql security definer set search_path = public as $fn$
declare tenant record;
begin
  for tenant in
    select o.id, o.schema_name
      from public.organizations o
     where exists (
       select 1 from information_schema.schemata s
       where s.schema_name = o.schema_name
     )
  loop
    perform public.ensure_tenant_members(tenant.schema_name, tenant.id);
  end loop;

  -- Admin/cleaner details now live only in org_<slug>.members.
  update public.profiles
     set full_name = null, nic = null, must_change_password = null
   where role in ('admin','cleaner')
     and exists (select 1 from auth.users u where u.id = public.profiles.id);
end $fn$;

-- ---------------------------------------------------------------------------
-- 3. Repoint tenant FKs from public.profiles to org_<slug>.members
-- ---------------------------------------------------------------------------
do $$
declare
  org record;
  pair record;
  target regclass;
  old_fk record;
  new_name text;
begin
  for org in select id, schema_name from public.organizations loop
    if not exists (select 1 from information_schema.schemata where schema_name = org.schema_name) then
      continue;
    end if;

    for pair in
      select * from (values
        ('room_status_history', 'created_by'),
        ('daily_assignments',   'cleaner_id'),
        ('task_runs',           'cleaner_id'),
        ('media',               'created_by')
      ) as v(table_name, column_name)
    loop
      target := to_regclass(format('%I.%I', org.schema_name, pair.table_name));
      if target is null then
        continue;
      end if;

      for old_fk in
        select c.conname
          from pg_constraint c
         where c.conrelid = target
           and c.contype = 'f'
           and c.confrelid = 'public.profiles'::regclass
           and exists (
             select 1
               from unnest(c.conkey) k(attnum)
               join pg_attribute a
                 on a.attrelid = c.conrelid and a.attnum = k.attnum
              where a.attname = pair.column_name
           )
      loop
        execute format('alter table %I.%I drop constraint %I',
          org.schema_name, pair.table_name, old_fk.conname);
      end loop;

      new_name := pair.column_name || '_fkey';
      if not exists (
        select 1 from pg_constraint
        where conrelid = target and conname = new_name
      ) then
        execute format(
          'alter table %I.%I add constraint %I foreign key (%I) references %I.members(id)',
          org.schema_name, pair.table_name, new_name, pair.column_name, org.schema_name
        );
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RPCs used by login, admin screens, rooms, and password changes
-- ---------------------------------------------------------------------------

-- Own member row (no NIC) for an admin/cleaner.
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

-- Org staff list. NIC is only available through this staff-only function.
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

-- Password change updates the right store for each role.
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
   where id = auth.uid() and role in ('platform_admin','org_admin');

  if s is not null then
    execute format('update %I.members set must_change_password = false where id = auth.uid()', s);
  end if;
end $fn$;

-- Login options: members plus the org_admin from the public map.
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

-- Server-side member insert. Only admin/cleaner belong in members.
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

-- Room reads/writes stay in public RPCs: no service_role grants in tenants.
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
                 'room_id', room_id, 'branch_id', branch_id, 'current_status', current_status
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
  select array_agg(distinct value->>'room_id'), array_agg(distinct value->>'branch_id')
    into room_ids, branch_ids
    from jsonb_array_elements(p_rooms);
  room_ids := coalesce(room_ids, '{}');
  branch_ids := coalesce(branch_ids, '{}');

  execute format('delete from %1$I.rooms where room_id <> all($1::text[])', s) using room_ids;
  execute format('delete from %1$I.branches where branch_id <> all($1::text[])', s) using branch_ids;
  execute format(
    'insert into %1$I.branches (branch_id) select unnest($1::text[]) on conflict (branch_id) do nothing',
    s
  ) using branch_ids;
  execute format($q$
    insert into %1$I.rooms (room_id, branch_id)
    select value->>'room_id', value->>'branch_id' from jsonb_array_elements($1)
    on conflict (room_id) do update set branch_id = excluded.branch_id
  $q$, s) using p_rooms;

  update public.organizations set rooms_locked = true where id = p_org_id;
  return jsonb_array_length(p_rooms);
end $fn$;

-- ---------------------------------------------------------------------------
-- 5. Permissions: service_role never gets tenant-schema grants
-- ---------------------------------------------------------------------------
revoke all on function public.ensure_tenant_members(text,uuid) from public, anon, authenticated;
revoke all on function public.sync_tenant_members() from public, anon, authenticated;
revoke all on function public.my_tenant_user() from public, anon;
revoke all on function public.tenant_users(text) from public, anon;
revoke all on function public.mark_password_changed() from public, anon;
revoke all on function public.list_organization_users(uuid) from public, anon, authenticated;
revoke all on function public.insert_tenant_user(uuid,uuid,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.list_organization_rooms(uuid) from public, anon, authenticated;
revoke all on function public.save_organization_rooms(uuid,jsonb) from public, anon, authenticated;

grant execute on function public.tenant_users(text),
                            public.my_tenant_user(),
                            public.mark_password_changed() to authenticated;
grant execute on function public.ensure_tenant_members(text,uuid),
                            public.sync_tenant_members(),
                            public.list_organization_users(uuid),
                            public.insert_tenant_user(uuid,uuid,text,text,text,text,boolean),
                            public.list_organization_rooms(uuid),
                            public.save_organization_rooms(uuid,jsonb) to service_role;

do $$
declare t record;
begin
  for t in select schema_name from public.organizations loop
    if exists (select 1 from information_schema.schemata where schema_name = t.schema_name) then
      execute format('revoke all on all tables in schema %I from service_role', t.schema_name);
      execute format('revoke all on all sequences in schema %I from service_role', t.schema_name);
      execute format('revoke usage on schema %I from service_role', t.schema_name);
    end if;
  end loop;
end $$;

-- Apply to the existing org_mercuryfm schema and refresh PostgREST.
select public.sync_tenant_members();
notify pgrst, 'reload schema';
