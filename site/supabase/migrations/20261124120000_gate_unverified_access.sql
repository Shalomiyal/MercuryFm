-- Deny tenant access until the profile's email address is verified.
-- Additive/idempotent: replaces only the two helper functions, never drops data.
do $do$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'email_verified'
  ) then
    execute $fn$
      create or replace function public.my_schema() returns text
      language sql stable security definer set search_path = public as $body$
        select o.schema_name
          from public.profiles p
          join public.organizations o on o.id = p.org_id
         where p.id = auth.uid()
           and o.is_active
           and p.email_verified is true
      $body$;
    $fn$;

    execute $fn$
      create or replace function public.in_org(s text) returns boolean
      language sql stable as $body$
        select public.my_schema() = s
      $body$;
    $fn$;

    execute 'grant execute on function public.my_schema() to authenticated, service_role';
    execute 'grant execute on function public.in_org(text) to authenticated, service_role';
  end if;
end
$do$;
