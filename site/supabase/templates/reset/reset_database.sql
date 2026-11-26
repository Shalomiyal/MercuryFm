-- DESTRUCTIVE RESET
-- Run manually in Supabase SQL Editor only.
-- This removes all organizations, tenant schemas, profiles, and Auth users.

begin;

-- Drop every tenant schema created by provision_organization.
do $$
declare
  tenant record;
begin
  for tenant in
    select schema_name
    from public.organizations
    where schema_name like 'org_%'
  loop
    execute format('drop schema if exists %I cascade', tenant.schema_name);
  end loop;
end $$;

-- Remove remaining tenant schemas even if public.organizations is inconsistent.
do $$
declare
  tenant record;
begin
  for tenant in
    select n.nspname as schema_name
    from pg_namespace n
    where n.nspname like 'org_%'
  loop
    execute format('drop schema if exists %I cascade', tenant.schema_name);
  end loop;
end $$;

-- Remove shared application data.
truncate table public.profiles restart identity cascade;
truncate table public.organizations restart identity cascade;

-- Remove all Supabase Auth users and their sessions/identities.
delete from auth.users;

-- Restore PostgREST exposure after tenant schemas are removed.
select public.refresh_exposed_schemas();

commit;
