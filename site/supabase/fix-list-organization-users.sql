-- Run once in the Supabase SQL Editor.
-- Fixes the `column reference "id" is ambiguous` error in login options.
-- Safe to re-run.

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

revoke all on function public.list_organization_users(uuid) from public, anon, authenticated;
grant execute on function public.list_organization_users(uuid) to service_role;

notify pgrst, 'reload schema';
