# Go-live checklist

Complete every item and record who verified it and when. Never record secret
values — only the variable names and the fact that they were set.

## Database

- [ ] Baseline scripts from `docs/MIGRATIONS.md` applied to the production project.
- [ ] New migrations `20261124120000` through `20261124120600` applied in timestamp order.
- [ ] `npm run check:supabase` reports `MISSING_RPCS: (none)`.
- [ ] `docs/rls-tests.sql` run: no `service_role` grants in `org_*` schemas,
      no `anon` execute on listed RPCs, no plaintext verification codes.
- [ ] `rooms_locked` set correctly for the production organization.
- [ ] Forward-only rollback plan documented (new timestamped migration, no drops).

## Environment and secrets

- [ ] Set by name in Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
      `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
      `SUPABASE_JWKS_URL`, `SUPABASE_DB_URL`.
- [ ] `VITE_API_BASE_URL` empty so the SPA uses same-origin `/api`.
- [ ] SMTP variables set by name if email delivery is used.
- [ ] Optional Turnstile variables set by name if bot protection is enabled.
- [ ] Rotated credentials that were previously exposed: database password,
      SMTP credentials, and the shared Supabase secret key.
- [ ] No `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, or SMTP password in any
      `VITE_` variable or client bundle.

## Supabase Auth settings

- [ ] Email provider enabled and SMTP configured with a verified sender.
- [ ] Phone/SMS authentication disabled.
- [ ] Site URL set to the production domain.
- [ ] Redirect allowlist includes `https://<domain>/auth/callback` plus the local
      callback URLs used for testing.
- [ ] Session/JWKS configuration matches `SUPABASE_JWKS_URL`.
- [ ] Magic-link template no longer claims NIC is a password.

## Quality gates

- [ ] `npm run lint` — 0 errors.
- [ ] `npm test` — all unit tests pass.
- [ ] `npm run build` — succeeds; initial JS under ~200 KB gzip.
- [ ] `npm run test:e2e` — smoke tests pass after `npx playwright install chromium`.
- [ ] `npm run audit:prod` — no high or critical production advisories.
- [ ] `npm run check:supabase` — green.

## Functional smoke test

- [ ] Platform admin signs in at `/platform-login`; organizations and user management open.
- [ ] Org admin signs in; all six admin sections open.
- [ ] Admin signs in with the restricted menu (no users / rooms setup).
- [ ] Cleaner signs in; tasks and history open on mobile viewport.
- [ ] Create invite → signup with invite code → verification code → one-time temp
      password → forced password change → correct role home page.
- [ ] Rooms import, template import, assignment creation, task start/finish,
      custom field entry, and photo upload all work.
- [ ] Refresh button, Realtime update, and focus refresh all update the UI.
- [ ] Unknown URL shows the 404 page; every route sets its own document title.
- [ ] Light/dark toggle persists after reload.

## Monitoring and handoff

- [ ] Server error logs and `public.audit_log` reviewed for the test run.
- [ ] `docs/ADMIN_GUIDE.md` and `docs/CLEANER_GUIDE.md` shared with pilot users.
- [ ] `docs/RUNBOOK.md` linked from the support channel.
- [ ] `CHANGES.md` reviewed and attached to the release record.
