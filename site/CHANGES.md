# Mercury FM production-readiness change record

Scope: production-readiness pass on the React 19 + Vite SPA, Vercel `/api` functions, and Supabase multi-tenant Postgres. Existing working code, routes, API paths, response shapes, CSS class names, and `.sql` files were preserved. New database work is confined to new timestamped, idempotent migrations under `supabase/migrations/`.

Status meanings:

- **DONE before** — already present and verified at the start of this pass; no change needed.
- **ADDED** — implemented in this pass.
- **SKIPPED — reason** — intentionally not done, with the reason and the file to check where relevant.

## Baseline (verified, no rewrite)

| Item | Status | Files touched |
| --- | --- | --- |
| Core SPA, role-based routes and dashboards | DONE before | `src/App.jsx`, `src/pages/*` |
| Tenant auth, login, signup, verify, reset flows | DONE before | `src/contexts/AuthContext.jsx`, `src/pages/*` |
| Postgres verification codes (SHA-256, 10 min, 5 attempts, 60 s resend) | DONE before | `api/lib/emailVerification.js`, `api/send-code.js`, `api/verify-code.js`, `supabase/email-verification.sql` |
| Admin user management (create, role, reset, deactivate, delete) | DONE before | `api/manage-user.js`, `api/create-user.js`, `src/pages/UsersPage.jsx`, `src/pages/PlatformUsersPage.jsx` |
| Excel template and room import with lazy `exceljs` | DONE before | `src/lib/excel.js`, `src/pages/TemplatesPage.jsx`, `src/pages/OrganizationRoomsPage.jsx` |
| Database media upload, chunks, and Range-served playback | DONE before | `api/media/*`, `src/lib/media.js` |
| Upload retry behaviour | DONE before | `src/lib/media.js` |
| TLS-pinned database connection (CA embedded, verification enabled) | DONE before | `api/lib/supabaseCa.js` |
| NIC treated as staff-only identity data, never a password | DONE before | `src/pages/UsersPage.jsx`, `src/pages/SignupPage.jsx` |

## Phase 1 — security and server hardening

| Item | Status | Files touched |
| --- | --- | --- |
| Shared JSON error helper with server-side-only logging | ADDED | `api/lib/httpError.js` |
| High-entropy random temporary passwords | ADDED | `api/lib/passwords.js` |
| Rate limiting with shared Postgres counter and local fallback | ADDED | `api/lib/rateLimit.js`, `supabase/migrations/20261124120100_rate_limits.sql` |
| Audit log table and writer | ADDED | `api/lib/audit.js`, `supabase/migrations/20261124120200_audit_log.sql` |
| Invite codes (hash-only, single-use, expiring) | ADDED | `api/lib/invites.js`, `supabase/migrations/20261124120300_org_invites.sql` |
| Optional Turnstile verification | ADDED | `api/lib/turnstile.js`, `.env.example` |
| Server-owned verification / password-change gates in `verifyUser` | ADDED | `api/lib/serverSupabase.js` |
| Invite-only signup, one-time temp password display | ADDED | `api/start-signup.js`, `src/pages/SignupPage.jsx` |
| Create invite, create user, and change password endpoints | ADDED | `api/create-invite.js`, `api/create-user.js`, `api/change-password.js` |
| Legacy signup endpoints return generic `410 Gone` | ADDED | `api/signup-user.js`, `api/send-signup-link.js` |
| Rollback and manage-user fixes | ADDED | `api/manage-user.js`, `api/create-organization.js` |
| Media authorization, MIME allowlist, magic-byte and size validation | ADDED | `api/media/complete.js`, `api/media/start.js`, `api/media/chunk.js` |
| Security response headers | ADDED | `vercel.json` |
| Local Vite `/api` shim containment | ADDED | `vite.config.js` |
| Redirect allowlist validation | ADDED | `src/lib/authFlow.js` |
| Unverified-access gate migration | ADDED | `supabase/migrations/20261124120000_gate_unverified_access.sql` |
| rooms_locked display and handling | ADDED | `src/pages/OrganizationRoomsPage.jsx`, `src/pages/PlatformPage.jsx` |
| Fixed misleading "locked" notice and the matching server-side 409 that blocked org admins from re-saving rooms; rooms_locked is now informational only, as documented | ADDED | `api/load-rooms.js`, `src/pages/OrganizationRoomsPage.jsx` |
| Production audit script and gitleaks config | ADDED | `package.json`, `.gitleaks.toml`, `.gitignore`, `docs/SECURITY_SETUP.md` |

## Phase 2 — data flow and performance

| Item | Status | Files touched |
| --- | --- | --- |
| Shared Realtime / focus / manual refresh signal | ADDED | `src/contexts/DataRefreshContext.jsx` |
| Visible "Last updated" bar and refresh button | ADDED | `src/components/ui/DataRefreshBar.jsx`, `src/components/AppShell.jsx` |
| One-call startup context RPC with three-call fallback | ADDED | `supabase/migrations/20261124120400_auth_context.sql`, `src/contexts/AuthContext.jsx` |
| Aggregate dashboard counters RPC with client fallback | ADDED | `supabase/migrations/20261124120500_dashboard_counts.sql`, `src/pages/DashboardPage.jsx` |
| Parallel dashboard queries | ADDED | `src/pages/DashboardPage.jsx` |
| Route-level code splitting with lazy/Suspense and `Outlet` | ADDED | `src/App.jsx`, `src/components/AppShell.jsx`, `src/components/ui/RouteFallback.jsx` |
| Reusable load-more pagination | ADDED | `src/hooks/usePagination.js`, `src/components/ui/LoadMoreButton.jsx` |
| Pagination wired into long lists | ADDED | `src/pages/DashboardPage.jsx`, `src/pages/RoomStatusPage.jsx`, `src/pages/CleanerTasksPage.jsx`, `src/pages/CleanerHistoryPage.jsx`, `src/pages/PlatformUsersPage.jsx`, `src/pages/PlatformPage.jsx`, `src/pages/OrganizationRoomsPage.jsx` |
| Refresh revision wired into data pages | ADDED | `src/pages/DashboardPage.jsx`, `src/pages/RoomStatusPage.jsx`, `src/pages/CleanerTasksPage.jsx`, `src/pages/CleanerHistoryPage.jsx`, `src/pages/DailyTasksPage.jsx`, `src/pages/TemplatesPage.jsx`, `src/pages/UsersPage.jsx`, `src/pages/PlatformUsersPage.jsx`, `src/pages/PlatformPage.jsx`, `src/pages/OrganizationRoomsPage.jsx` |
| 12-hour locale dates/times and friendly error messages | ADDED | `src/lib/format.js`, data pages |
| Manual chunks and initial JS under ~200 KB gzip | ADDED | `vite.config.js` |

## Phase 3 — UI and accessibility

| Item | Status | Files touched |
| --- | --- | --- |
| Missing CSS classes, shared tokens, dark mode | ADDED | `src/styles.css`, `src/contexts/ThemeContext.jsx` |
| Reusable UI components | ADDED | `src/components/ui/*` |
| In-app confirm dialogs replacing `window.confirm` | ADDED | `src/components/ui/ConfirmProvider.jsx`, `src/pages/DailyTasksPage.jsx`, `src/pages/TemplatesPage.jsx`, `src/pages/UsersPage.jsx`, `src/pages/PlatformUsersPage.jsx`, `src/main.jsx` |
| Dialog Escape handling and focus trap | ADDED | `src/components/ui/DialogA11y.jsx`, `src/main.jsx` |
| Show/hide password inputs | ADDED | `src/components/ui/PasswordInput.jsx`, `src/pages/LoginPage.jsx`, `src/pages/PlatformLoginPage.jsx`, `src/pages/ChangePasswordPage.jsx`, `src/pages/ResetPasswordPage.jsx` |
| Skeleton loading states | ADDED | `src/components/ui/Skeleton.jsx`, `src/components/ui/RouteFallback.jsx` |
| Favicon and page metadata | ADDED | `public/favicon.svg`, `index.html` |
| Per-route document titles | ADDED | `src/components/DocumentTitle.jsx`, `src/App.jsx` |
| 404 page | ADDED | `src/pages/NotFoundPage.jsx`, `src/App.jsx` |
| Mobile top-bar and accessibility polish | ADDED | `src/components/AppShell.jsx`, `src/styles.css` |
| Visible border, white interior and dark text on every value-entry field (Tailwind reset had removed input borders); task field value boxes stay readable in dark mode | ADDED | `src/styles.css` |
| Distinct colour codes per room/task status shared by badges, history dots and task-state chips | ADDED | `src/styles.css` |
| Idempotent template assignment: repeated assign no longer hits the unique key, existing day tasks are kept, template tasks are copied only once | ADDED | `supabase/migrations/20261124120600_idempotent_template_assignment.sql`, `src/pages/DailyTasksPage.jsx`, `docs/MIGRATIONS.md`, `docs/GO_LIVE_CHECKLIST.md` |

## Phase 4 — quality gates and handoff

| Item | Status | Files touched |
| --- | --- | --- |
| ESLint flat config and scripts | ADDED | `eslint.config.js`, `package.json` |
| Prettier config and scripts | ADDED | `.prettierrc.json`, `.prettierignore`, `package.json` |
| Vitest + Testing Library unit tests (17 passing) | ADDED | `vite.config.js`, `tests/setup.js`, `tests/*.test.js`, `tests/*.test.jsx` |
| Playwright smoke tests (3 passing) | ADDED | `playwright.config.js`, `tests/e2e/smoke.spec.js` |
| Read-only RLS verification script | ADDED | `docs/rls-tests.sql` |
| CI workflow | ADDED | `.github/workflows/ci.yml` |
| Error boundary with optional host-provided Sentry hook | ADDED | `src/components/ErrorBoundary.jsx`, `src/main.jsx` |
| Migration ordering and rollback policy doc | ADDED | `docs/MIGRATIONS.md` |
| README additive updates (superseded sections flagged) | ADDED | `README.md` |
| Role guides, runbook and go-live checklist | ADDED | `docs/ADMIN_GUIDE.md`, `docs/CLEANER_GUIDE.md`, `docs/RUNBOOK.md`, `docs/GO_LIVE_CHECKLIST.md` |
| Change record | ADDED | `CHANGES.md` |

## Skipped

| Item | Status | Files touched / to check |
| --- | --- | --- |
| Applying new migrations from this environment | SKIPPED — no working production DB authentication from here (`28P01` after TLS succeeds); must be run in the Supabase SQL Editor in timestamp order | `supabase/migrations/20261124120000_*.sql` through `20261124120600_*.sql`; `docs/MIGRATIONS.md` |
| Live Brevo email receipt and end-to-end invite → verify → change-password → role-dashboard confirmation | SKIPPED — requires real credentials and a real inbox | `api/start-signup.js`, `api/send-code.js`, `api/verify-code.js`; `docs/GO_LIVE_CHECKLIST.md` |
| Git history verification for previously committed secrets | SKIPPED — workspace is not a git repository | run gitleaks from a clone of the real repository; `.gitleaks.toml` |
| Installing/configuring a Sentry SDK and DSN | SKIPPED — intentionally optional; no DSN supplied and no hard dependency added | `src/components/ErrorBoundary.jsx` (calls `window.Sentry.captureException` if the host app provides it) |
| Removing the in-memory verification-code and rate-limit fallbacks | SKIPPED — kept deliberately for pre-migration environments | `api/lib/emailVerification.js`, `api/lib/rateLimit.js` |
| Express server, `server`, `cors`, `dotenv`, or `express-rate-limit` | SKIPPED — explicitly out of scope; Vite middleware locally and Vercel functions in production | `vite.config.js`, `api/*` |
| Email/SMTP credentials or sending logic in React | SKIPPED — server-only by design | `api/lib/emailVerification.js`, `api/start-signup.js` |
| Editing any existing `.sql` file | SKIPPED — policy; all database changes are new timestamped migrations | `supabase/migrations/*` |
| Abandoned sign-language project | SKIPPED — not part of the correct Mercury FM project | n/a |

## Manual steps required after this pass

1. Run the seven new migrations in `supabase/migrations/` in timestamp order, then `npm run check:supabase` (expect `MISSING_RPCS: (none)`).
2. Set environment variables **by name only** in Vercel and locally: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, `SUPABASE_DB_URL`, optional SMTP names, optional Turnstile names. Keep `VITE_API_BASE_URL` empty.
3. Rotate the previously exposed database password, SMTP credentials, and shared Supabase secret key at their providers before going live.
4. In Supabase Auth: enable Email, disable Phone/SMS, set the Site URL and redirect allowlist (including `/auth/callback`), and configure a verified SMTP sender. Replace any email template that says NIC is a password.
5. Run `docs/rls-tests.sql` in the SQL Editor and work through `docs/GO_LIVE_CHECKLIST.md`.

## Items to double-check in a real deployment

| Concern | File to check |
| --- | --- |
| `get_my_context()` JSON shape matches the client parser, including tenant-user arrays | `supabase/migrations/20261124120400_auth_context.sql`, `src/contexts/AuthContext.jsx` |
| Realtime publication includes tenant tables; failure is non-fatal, focus refresh still applies | `src/contexts/DataRefreshContext.jsx` |
| Shared rate-limit RPC returns `allowed` / `retry_after_seconds` as expected | `supabase/migrations/20261124120100_rate_limits.sql`, `api/lib/rateLimit.js` |
| Invite creation UI: endpoint exists and is role-gated, but there is no dedicated admin screen yet; use the API/RPC until one is added | `api/create-invite.js`, `docs/ADMIN_GUIDE.md` |
| New idempotent assignment RPC returns one `bigint` assignment id and must be executable by `authenticated` | `supabase/migrations/20261124120600_idempotent_template_assignment.sql`, `src/pages/DailyTasksPage.jsx` |
| Status colour palette is duplicated in earlier rules; appended rules are authoritative because they appear last in the file | `src/styles.css` |
| Archived README sections describe the retired magic-link/NIC-password flow and are superseded by the section at the top | `README.md` |
