grant usage on schema public to anon, authenticated, service_role;

grant select on public.organizations, public.profiles to authenticated, service_role;
grant all on public.organizations, public.profiles to service_role;

grant execute on function public.my_role() to anon, authenticated, service_role;
grant execute on function public.my_org_id() to anon, authenticated, service_role;
grant execute on function public.my_schema() to anon, authenticated, service_role;
grant execute on function public.is_platform_admin() to anon, authenticated, service_role;
grant execute on function public.in_org(text) to anon, authenticated, service_role;
grant execute on function public.is_org_staff(text) to anon, authenticated, service_role;

-- Provisioning and schema refresh are service-role operations.
revoke execute on function public.provision_organization(text, text) from public, anon, authenticated;
revoke execute on function public.refresh_exposed_schemas() from public, anon, authenticated;
grant execute on function public.provision_organization(text, text) to service_role;
grant execute on function public.refresh_exposed_schemas() to service_role;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "platform admin all orgs" on public.organizations;
create policy "platform admin all orgs" on public.organizations
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "see own org" on public.organizations;
create policy "see own org" on public.organizations
  for select
  using (id = public.my_org_id());

drop policy if exists "platform admin all profiles" on public.profiles;
create policy "platform admin all profiles" on public.profiles
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select
  using (id = auth.uid());

drop policy if exists "read profiles in my org" on public.profiles;
create policy "read profiles in my org" on public.profiles
  for select
  using (id = auth.uid() or org_id = public.my_org_id());
