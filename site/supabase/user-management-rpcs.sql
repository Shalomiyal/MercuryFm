-- Run once in the Supabase SQL Editor for the Mercury FM project.
-- Adds the server-only RPCs used by /admin/users.
-- Safe to re-run. Service_role never receives grants inside tenant schemas.

-- Changes an admin/cleaner role inside org_<slug>.members.
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
  if not exists (select 1 from information_schema.schemata where schema_name = s) then
    raise exception 'Organization schema not found';
  end if;

  execute format('update %I.members set role = $1 where id = $2', s)
    using p_role, p_user_id;
  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'Tenant user not found';
  end if;
end $fn$;

-- Returns the NIC so the server can reset that user's Auth password to it.
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
  if not exists (select 1 from information_schema.schemata where schema_name = s) then
    raise exception 'Organization schema not found';
  end if;

  execute format('select nic from %I.members where id = $1', s)
    into nic_value using p_user_id;
  return nic_value;
end $fn$;

-- Clears the forced-password-change flag after an admin resets a password.
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
  if not exists (select 1 from information_schema.schemata where schema_name = s) then
    raise exception 'Organization schema not found';
  end if;

  execute format('update %I.members set must_change_password = $1 where id = $2', s)
    using p_must_change_password, p_user_id;
  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'Tenant user not found';
  end if;
end $fn$;

revoke all on function public.update_tenant_user_role(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.get_tenant_user_nic(uuid,uuid) from public, anon, authenticated;
revoke all on function public.set_tenant_user_must_change_password(uuid,uuid,boolean) from public, anon, authenticated;

grant execute on function public.update_tenant_user_role(uuid,uuid,text),
                            public.get_tenant_user_nic(uuid,uuid),
                            public.set_tenant_user_must_change_password(uuid,uuid,boolean) to service_role;

notify pgrst, 'reload schema';
