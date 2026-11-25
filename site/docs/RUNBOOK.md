# Operations runbook

Use this for production incidents. Do not print or paste secret values into
tickets, chat, or logs.

## User cannot sign in

1. Confirm the user is using `/login` (organization users) or `/platform-login`
   (platform admins) and entered the correct organization code.
2. Check `public.profiles.email_verified` and `must_change_password` for that
   user. The server enforces both flags; editing the browser profile has no
   effect.
3. If the account is unverified, confirm the user completed `/verify-email`.
   If the code expired, ask them to request a new one (60-second cooldown).
4. If the account has `must_change_password`, route the user to
   `/change-password`.
5. If the user has a new temp password from an admin, confirm it was copied
   before the one-time display closed. Admins should reset it if needed.

## Verification email not received

1. Check the SMTP settings in Supabase Authentication and the server-side SMTP
   environment variables (set by name only in Vercel).
2. Check spam/quarantine and the sender allowlist.
3. In development only, an unconfigured SMTP provider renders the message to
   the server console with a `[DEV ONLY]` label. This never happens in
   production.
4. Check `public.email_verification_codes` for the row's expiry and attempt
   count. Never read or store the plaintext code.

## Too many requests (429)

1. Rate limits are shared through `public.rate_limit_buckets` when migration
   2 is applied; otherwise each instance counts locally.
2. Confirm the caller is behind Vercel so the trusted rightmost forwarded
   address is used. Do not trust client-supplied `x-forwarded-for`.
3. Wait for the `retryAfter` interval. Do not disable the limiter to "fix" a
   single user.

## Permission denied / data missing

1. Ask the user to sign out and back in so role and schema are reloaded from
   `get_my_context()`.
2. Run `docs/rls-tests.sql`. Look for `service_role` grants inside `org_*`
   schemas (must be zero) and `anon_can_execute` on public RPCs (must be false).
3. Check that the user's role is correct in their tenant `members` row or
   `public.profiles`. NIC is staff-only and exposed only through
   `tenant_users()`.

## Data looks stale

1. Use the **Refresh** button in the top bar.
2. Confirm the browser tab is online and Realtime is not blocked by a proxy.
   Realtime failure is non-fatal; focus refresh still works.
3. If dashboard counters look wrong, confirm
   `20261124120500_dashboard_counts.sql` was applied. The client silently falls
   back to counting assignments locally.
4. Check the **Last updated** label; if it never changes, check the browser
   console for a reporting error.

## Media upload or photo fails

1. Confirm the file is an allowed image type and within the size limit.
2. Check `/api/media/start`, `/api/media/chunk`, and `/api/media/complete`
   responses for a 4xx cause (type, size, or authorization) before retrying.
3. Confirm the user is a cleaner acting on their own task; other roles are
   rejected by the handlers.
4. Verify tenant `media` / `media_chunks` tables and the TLS connection string.
   Certificate verification stays enabled; do not disable it.

## Build, lint, or test failure in CI

1. Run locally: `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`.
2. If lint reports hook dependency warnings, they are advisory; errors are not.
3. Smoke tests use non-secret placeholder Supabase settings. If they fail to
   boot, check that `npm run dev` starts and serves `/login`.
4. Install the Playwright browser with `npx playwright install --with-deps chromium`
   in CI.

## Credential exposure

1. Rotate the affected credential at the provider first.
2. Update the matching environment variable **by name** in Vercel and locally.
3. Redeploy and re-run `npm run lint`, `npm test`, `npm run build`, and
   `docs/rls-tests.sql`.
4. Search the repository with `npm run audit:prod` and gitleaks for accidental
   secret commits. Never write the value into `CHANGES.md` or these docs.
