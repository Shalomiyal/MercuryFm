# Database migrations

## Rules

- Existing `.sql` files are historical baseline scripts and are never edited.
- Every change after this point is a **new, timestamped, idempotent** file in
  `supabase/migrations/`. These files use `create or replace` / `if not exists`,
  contain no `drop` statements, and are safe to re-run.
- Migrations are applied in timestamp order. If a fix is needed, add a newer
  timestamped file rather than editing an older one.
- New code must work before and after a migration. Client code and API handlers
  use fallbacks when a new RPC or table is not deployed yet.
- Never put secret values in a migration or in documentation.

## Baseline scripts (existing projects, run once)

Run these in the Supabase SQL Editor only if your project predates them. Each
file documents its own prerequisite:

1. `supabase/apply-tenant-rpcs.sql` — tenant/provisioning RPCs for an existing project.
   For a brand-new project use `docs/platform.sql` instead.
2. `supabase/fix-list-organization-users.sql` — user listing RPC.
3. `supabase/user-management-rpcs.sql` — role/password tenant-user RPCs.
4. `supabase/tenant-users-migration.sql` and `supabase/members-followup.sql` —
   tenant `members` table and follow-up columns.
5. `supabase/task-fields-and-start-times.sql` — `start_by`, `template_task_id`,
   `task_fields`, `daily_task_field_values`.
6. `supabase/email-verification.sql` — `email_verified` and
   `public.email_verification_codes`.
7. `supabase/grant-tenant-service-role.sql` — verify that this has **not** granted
   tenant-schema access to `service_role`; the intended state is no grants.

Verify the baseline with `npm run check:supabase`. `MISSING_RPCS` should print
`(none)`.

## New migrations (apply in this order)

| Order | File | Purpose |
| --- | --- | --- |
| 1 | `20261124120000_gate_unverified_access.sql` | Server-owned `email_verified` / `must_change_password` gates via `public.my_schema()`, `public.in_org()` and profile updates. |
| 2 | `20261124120100_rate_limits.sql` | `public.rate_limit_buckets` and `public.consume_rate_limit()` shared counter. Handlers fall back to a per-instance counter if missing. |
| 3 | `20261124120200_audit_log.sql` | `public.audit_log` and `public.write_audit_log()` for invite, signup, role, and user-management events. |
| 4 | `20261124120300_org_invites.sql` | `public.organization_invites`, `create_organization_invite()`, `validate_organization_invite()`, `consume_organization_invite()`. Codes are stored as hashes and are single-use. |
| 5 | `20261124120400_auth_context.sql` | `public.get_my_context()` returns profile, schema, and tenant user in one startup call. NIC is deliberately omitted. The client falls back to the older three-call path. |
| 6 | `20261124120500_dashboard_counts.sql` | `public.get_dashboard_counts(date)` aggregates room and task counters in the database. The dashboard falls back to client-side counting if missing. |
| 7 | `20261124120600_idempotent_template_assignment.sql` | `public.assign_template_tasks(date, uuid, bigint)` reuses an existing assignment on the unique `(work_date, cleaner_id, template_id)` key and copies template tasks only once. The client falls back to a read-then-insert path if missing. |

Apply them with the Supabase CLI:

```powershell
supabase link --project-ref <YOUR-PROJECT-REF>
supabase db push
```

or paste each file into the Supabase SQL Editor in the order shown. A rerun of
an already-applied migration is harmless.

## Verification

1. `npm run check:supabase` — expected `MISSING_RPCS: (none)`.
2. Run `docs/rls-tests.sql` in the SQL Editor. It is read-only and rolls back.
   Confirm `anon_can_execute` is false for every listed RPC, zero
   `service_role` grants in `org_*` schemas, and zero non-hashed codes.
3. Sign in as each role once and confirm the correct home page opens. Verify
   that an unverified account is sent to `/verify-email` and an account with
   `must_change_password` is sent to `/change-password`.

## Forward-only fixes

If a deployed migration is wrong, add a newer timestamped file that uses
`create or replace` or `alter table ... add column if not exists`. Do not edit
or re-run destructive statements, and do not reset the database. Document the
new file here and in `CHANGES.md`.
