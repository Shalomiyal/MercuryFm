-- Mercury FM read-only authorization checks.
-- Run this file in the Supabase SQL Editor against the target project.
-- Everything runs inside a transaction that is always rolled back, so this
-- script cannot create, change, or delete application data.
--
-- "Expected" notes describe a healthy production database. Rows returned are
-- evidence; any unexpected row is something to investigate, not something to
-- fix by editing this file.

begin;

-- 1. Server-owned account state must exist in public.profiles. Clients cannot
--    bypass email verification or first-login password change by editing their
--    cached profile.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name in ('role', 'org_id', 'email_verified', 'must_change_password')
order by column_name;
-- Expected: four rows.

-- 2. The service role must have NO grants inside tenant schemas. All elevated
--    writes go through public security-definer RPCs instead.
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'service_role'
  and table_schema like 'org\_%'
order by 1, 2, 3;
-- Expected: zero rows.

-- 3. Required public RPCs, their security-definer flag, and who can execute
--    them. anon_can_execute must be false for every row.
select
  p.proname,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'execute') as service_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'my_schema',
    'in_org',
    'get_my_context',
    'get_dashboard_counts',
    'consume_rate_limit',
    'write_audit_log',
    'create_organization_invite',
    'validate_organization_invite',
    'consume_organization_invite',
    'tenant_users'
  )
order by p.proname;
-- Expected: anon_can_execute = false on every row. Missing rows mean a
-- migration from docs/MIGRATIONS.md has not been applied yet.

-- 4. New Phase 1 tables exist.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'audit_log',
    'rate_limit_buckets',
    'organization_invites',
    'email_verification_codes'
  )
order by table_name;
-- Expected: four rows (email_verification_codes comes from the earlier setup).

-- 5. Tenant RLS policies are present.
select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname like 'org\_%'
  and tablename in ('members', 'rooms', 'task_runs', 'daily_task_field_values')
order by 1, 2, 3;
-- Expected: members has a self-read policy plus org_admin/admin management
-- policies; daily_task_field_values lets cleaners update only their own rows.

-- 6. No verification code is stored in plaintext. Every stored hash is 64
--    lowercase hex characters (SHA-256).
select
  count(*) as total_codes,
  count(*) filter (
    where code_hash !~ '^[0-9a-f]{64}$'
  ) as non_hashed_codes
from public.email_verification_codes;
-- Expected: non_hashed_codes = 0.

rollback;

-- ---------------------------------------------------------------------------
-- Manual tenant-isolation probe (run separately, then replace both placeholders).
-- This uses a real JWT subject, so it is deliberately not part of the script.
--
-- set role authenticated;
-- set request.jwt.claim.sub = '<UUID of a cleaner in org_mercuryfm>';
-- select count(*) as own_rows from org_mercuryfm.members;               -- >= 1
-- select count(*) as other_rows from org_other_schema.members;          -- 0 or permission denied
-- select count(*) as nic_columns from org_mercuryfm.members where nic is not null;
-- reset role;
--
-- NIC is staff-only profile/tenant data exposed only through tenant_users().
-- A cleaner must never see another tenant's rows or another user's NIC.
