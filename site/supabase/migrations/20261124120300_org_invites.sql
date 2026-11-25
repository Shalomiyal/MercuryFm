-- One-time, expiring invite codes for self-service signup. Only the hash is
-- stored. Additive/idempotent; no drops or resets.
create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  code_hash text not null unique,
  email text,
  role public.user_role not null default 'cleaner',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists organization_invites_org_id_idx
  on public.organization_invites (org_id);
create index if not exists organization_invites_expires_at_idx
  on public.organization_invites (expires_at);

alter table public.organization_invites enable row level security;
revoke all on table public.organization_invites from anon, authenticated;
grant select, insert, update, delete on table public.organization_invites to service_role;

create or replace function public.create_organization_invite(
  p_org_id uuid,
  p_code_hash text,
  p_email text default null,
  p_role public.user_role default 'cleaner',
  p_expires_at timestamptz,
  p_created_by uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_code_hash is null or p_expires_at is null or p_expires_at <= now() then
    raise exception 'Invalid invite';
  end if;

  insert into public.organization_invites (
    org_id, code_hash, email, role, expires_at, created_by
  ) values (
    p_org_id,
    p_code_hash,
    nullif(lower(trim(p_email)), ''),
    p_role,
    p_expires_at,
    p_created_by
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.validate_organization_invite(
  p_code_hash text,
  p_email text default null
) returns table(invite_id uuid, org_id uuid, role public.user_role)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select i.id, i.org_id, i.role
      from public.organization_invites i
     where i.code_hash = p_code_hash
       and i.used_at is null
       and i.expires_at > now()
       and (i.email is null or lower(i.email) = lower(trim(p_email)))
     limit 1;
end;
$$;

create or replace function public.consume_organization_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.organization_invites
     set used_at = now()
   where id = p_invite_id
     and used_at is null
     and expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.create_organization_invite(uuid, text, text, public.user_role, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.validate_organization_invite(text, text) from public, anon, authenticated;
revoke all on function public.consume_organization_invite(uuid) from public, anon, authenticated;

grant execute on function public.create_organization_invite(uuid, text, text, public.user_role, timestamptz, uuid) to service_role;
grant execute on function public.validate_organization_invite(text, text) to service_role;
grant execute on function public.consume_organization_invite(uuid) to service_role;
