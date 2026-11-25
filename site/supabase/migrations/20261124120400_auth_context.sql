-- One startup RPC that replaces three separate calls during app boot.
-- Additive/idempotent; no drops, resets, or data changes.
create or replace function public.get_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile jsonb;
  v_schema text;
  v_tenant jsonb := null;
begin
  select jsonb_build_object(
           'id', p.id,
           'full_name', p.full_name,
           'role', p.role::text,
           'org_id', p.org_id,
           'must_change_password', p.must_change_password,
           'email_verified', p.email_verified
         )
    into v_profile
    from public.profiles p
   where p.id = auth.uid();

  if v_profile is null then
    return null;
  end if;

  v_schema := public.my_schema();

  -- NIC and other staff-only columns are deliberately omitted from this
  -- browser-facing payload.
  if v_schema is not null and v_profile->>'role' in ('admin', 'cleaner') then
    begin
      execute format($q$
        select to_jsonb(row_data)
          from (
            select id, full_name, phone, role::text as role,
                   is_active, must_change_password
              from %1$I.members
             where id = auth.uid()
          ) row_data
      $q$, v_schema)
      into v_tenant;
    exception when others then
      v_tenant := null;
    end;
  end if;

  return jsonb_build_object(
    'profile', v_profile,
    'schema_name', v_schema,
    'tenant_user', v_tenant
  );
end;
$$;

revoke all on function public.get_my_context() from public, anon;
grant execute on function public.get_my_context() to authenticated, service_role;

notify pgrst, 'reload schema';
