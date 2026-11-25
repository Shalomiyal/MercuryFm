# Security setup

This page lists the controls added for production readiness. It deliberately uses **variable names only** — never commit or paste values.

## 1. Apply migrations in order

Run each file in `supabase/migrations/` in the Supabase SQL Editor, oldest timestamp first:

1. `20261124120000_gate_unverified_access.sql` — server-side email verification gate for `my_schema()` / `in_org()`.
2. `20261124120100_rate_limits.sql` — shared rate-limit counter and RPC.
3. `20261124120200_audit_log.sql` — append-only audit log and write RPC.
4. `20261124120300_org_invites.sql` — one-time invite codes for signup.

All are idempotent and additive. Do not edit or re-run destructive legacy SQL.

> `supabase/email-verification.sql` backfills existing profiles to `email_verified = true`. If that migration was already applied, decide explicitly whether existing staff must re-verify; the new gate itself does not reset any flags.

## 2. Environment variables

Set these in Vercel (and locally in an untracked `.env`), by **name** only:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_JWKS_URL`
- `SUPABASE_DB_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`
- `APP_ORIGIN` (optional allowlist for future callback redirects)
- `TURNSTILE_SECRET_KEY` (optional; only when Turnstile is enabled)
- Browser-safe: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` (empty means same-origin `/api`), `VITE_TURNSTILE_SITE_KEY` (optional)

Never use a `VITE_` prefix for secrets. Never print values in logs or terminal output.

## 3. Supabase Auth settings

In the Supabase dashboard:

- Enable email confirmation handling for your chosen flow. The app uses its own 6-digit code and sends users directly to `/verify-email`.
- Restrict redirect URLs to the deployed origin plus `/auth/callback`; do not allow wildcard origins.
- Ensure `service_role` has no grants inside tenant schemas. Tenant reads/writes go through security-definer RPCs.
- Confirm RLS is enabled on `public.audit_log`, `public.rate_limit_buckets`, and `public.organization_invites`.

## 4. Invite flow

Administrators create a one-time code with `POST /api/create-invite`. New users enter the code on `/signup`; `start-signup` validates it, creates the account with a random temporary password, and consumes the code only after all rows are created. Codes are stored as SHA-256 hashes, expire (default 72 hours), and can be restricted to one email address.

The temporary password is returned **once** to the administrator/requester. The NIC is stored as identity data in the tenant schema only and is never used as a password.

## 5. Account state gates

`verifyUser()` rejects unverified users and users who must change their password before any privileged API handler runs. The only exceptions are:

- `/api/send-code` and `/api/verify-code` (no authenticated session required)
- `/api/change-password` (allows `must_change_password`, still requires verification)
- `/api/login-options` degrades to an empty `users` array for unverified callers

## 6. Rate limiting and audit

Shared counters use `public.consume_rate_limit`; the local in-memory fallback exists only until the migration is applied. The trusted client address is taken from the last hop of `x-forwarded-for`, never the client-controlled first entry.

Privileged mutations write to `public.audit_log` through `public.write_audit_log`. Auditing is best-effort and never changes an API response.

## 7. Optional Turnstile

Set both `TURNSTILE_SECRET_KEY` and `VITE_TURNSTILE_SITE_KEY` to require a Cloudflare Turnstile token on signup and code requests. When either is unset, the control is skipped entirely so local development keeps working.

## 8. Credential rotation

Rotate the previously exposed database password, SMTP credentials, and shared Supabase secret key in their respective providers. Update Vercel environment variables after rotation, then redeploy. Do not reuse old values or include them in tickets, logs, or chat.

## 9. Verification commands

- `npm run audit:prod` — production dependency audit.
- `npm run check:supabase` — endpoint/RPC smoke check.
- `npm run lint`, `npm test`, `npm run build` — local quality gates introduced in Phase 4.
