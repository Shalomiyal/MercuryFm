-- Run once in Supabase SQL Editor for the existing project.
-- Targets org_mercuryfm and installs the helpers for every organization.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Tenant user table + RLS for org_mercuryfm
-- ---------------------------------------------------------------------------
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

create or replace function public.sync_tenant_members()
returns void
language plpgsql security definer set search_path = public as $fn$
declare tenant record;
begin
  for tenant in select id, schema_name from public.organizations loop
    perform public.ensure_tenant_members(tenant.schema_name, tenant.id);
  end loop;

  update public.profiles
     set full_name = null, nic = null, must_change_password = null
   where role in ('admin','cleaner')
     and exists (select 1 from auth.users u where u.id = public.profiles.id);
end $fn$;

-- Backfill org_mercuryfm first, before profile details are nulled.
select public.ensure_tenant_members(
  'org_mercuryfm',
  (select id from public.organizations where slug = 'mercuryfm')
);

-- ---------------------------------------------------------------------------
-- 2. Repoint foreign keys to org_mercuryfm.members(id)
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select con.conname, rel.relname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'org_mercuryfm'
       and con.contype = 'f'
       and rel.relname in ('room_status_history','daily_assignments','task_runs','media')
       and con.confrelid = 'public.profiles'::regclass
  loop
    execute format('alter table org_mercuryfm.%I drop constraint %I', r.relname, r.conname);
  end loop;
end $$;

alter table org_mercuryfm.room_status_history
  add constraint room_status_history_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table org_mercuryfm.daily_assignments
  add constraint daily_assignments_cleaner_id_fkey
  foreign key (cleaner_id) references org_mercuryfm.members(id);
alter table org_mercuryfm.task_runs
  add constraint task_runs_cleaner_id_fkey
  foreign key (cleaner_id) references org_mercuryfm.members(id);
alter table org_mercuryfm.media
  add constraint media_created_by_fkey
  foreign key (created_by) references org_mercuryfm.members(id);

-- ---------------------------------------------------------------------------
-- 3. public.profiles becomes a minimal map
-- ---------------------------------------------------------------------------
alter table public.profiles alter column full_name drop not null;
alter table public.profiles alter column must_change_password drop not null;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_admin_details_check;
alter table public.profiles add constraint profiles_role_check check (
  (role = 'platform_admin' and org_id is null)
  or (role <> 'platform_admin' and org_id is not null)
);
alter table public.profiles add constraint profiles_admin_details_check check (
  (role in ('platform_admin','org_admin')
   and full_name is not null and must_change_password is not null)
  or (role in ('admin','cleaner')
   and full_name is null and nic is null and must_change_password is null)
);

-- Clear duplicate details now that they are safely in org_mercuryfm.members.
update public.profiles
   set full_name = null, nic = null, must_change_password = null
 where role in ('admin','cleaner');

-- ---------------------------------------------------------------------------
-- 4. Helper RPCs
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. Permissions: authenticated gets tenant access; service_role does not
-- ---------------------------------------------------------------------------
revoke all on function public.tenant_users(text)                  from public, anon;
revoke all on function public.my_tenant_user()                    from public, anon;
revoke all on function public.mark_password_changed()             from public, anon;
revoke all on function public.list_organization_users(uuid)        from public, anon, authenticated;
revoke all on function public.insert_tenant_user(uuid,uuid,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.list_organization_rooms(uuid)        from public, anon, authenticated;
revoke all on function public.save_organization_rooms(uuid,jsonb)  from public, anon, authenticated;

grant execute on function public.tenant_users(text),
                           public.my_tenant_user(),
                           public.mark_password_changed() to authenticated;
grant execute on function public.list_organization_users(uuid),
                           public.insert_tenant_user(uuid,uuid,text,text,text,text,boolean),
                           public.list_organization_rooms(uuid),
                           public.save_organization_rooms(uuid,jsonb) to service_role;

drop function if exists public.grant_tenant_service_role();

do $$
declare t record;
begin
  for t in select schema_name from public.organizations loop
    execute format('revoke all on all tables in schema %I from service_role', t.schema_name);
    execute format('revoke all on all sequences in schema %I from service_role', t.schema_name);
    execute format('revoke usage on schema %I from service_role', t.schema_name);
  end loop;
end $$;

-- Apply to any other organizations and refresh PostgREST's schema cache.
select public.sync_tenant_members();
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 6. Tenant isolation test (commented out — run manually with real IDs)
-- ---------------------------------------------------------------------------
-- set local role authenticated;
-- set local request.jwt.claim.sub = '<cleaner-id-from-org-A>';
-- select id from org_mercuryfm.members;              -- own row only
-- select count(*) from org_other.members;           -- 0 / no access
-- reset role;
