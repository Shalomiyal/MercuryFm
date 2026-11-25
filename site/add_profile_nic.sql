alter table public.profiles
  add column if not exists nic text;

comment on column public.profiles.nic is 'Only for platform_admin/org_admin. Admin and cleaner NICs live in org_<slug>.members.';
