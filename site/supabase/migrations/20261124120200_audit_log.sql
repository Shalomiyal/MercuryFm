-- Append-only audit trail for privileged mutations. Additive/idempotent.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  org_id uuid,
  target_user_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_occurred_at_idx on public.audit_log (occurred_at desc);
create index if not exists audit_log_org_id_idx on public.audit_log (org_id);
create index if not exists audit_log_target_user_id_idx on public.audit_log (target_user_id);

alter table public.audit_log enable row level security;

do $do$
begin
  if not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'audit_log'
       and policyname = 'audit_log_select_admins'
  ) then
    create policy audit_log_select_admins on public.audit_log
      for select to authenticated
      using (
        public.is_platform_admin()
        or (public.my_role() = 'org_admin' and public.in_org(org_id))
      );
  end if;
end
$do$;

revoke all on table public.audit_log from anon;
revoke insert, update, delete on table public.audit_log from authenticated;
grant select on table public.audit_log to authenticated;

create or replace function public.write_audit_log(
  p_actor_id uuid default null,
  p_action text,
  p_org_id uuid default null,
  p_target_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_action is null or length(trim(p_action)) = 0 then
    return;
  end if;

  insert into public.audit_log (
    actor_id, action, org_id, target_user_id, metadata
  ) values (
    p_actor_id,
    left(trim(p_action), 120),
    p_org_id,
    p_target_user_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.write_audit_log(uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.write_audit_log(uuid, text, uuid, uuid, jsonb) to service_role;
