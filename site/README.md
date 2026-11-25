# Multi-Tenant Room Status & Cleaning Management System

Mercury FM's role-based room and cleaning operations application. The UI is English-only and mobile-first for cleaning staff.

## Current production flow (authoritative)

This section takes precedence over the older "Email link setup", "Public signup with NIC", and "Node.js SMTP fallback for signup email" sections further down, which describe a retired flow.

- Signup is invite-only. An `org_admin` or `platform_admin` creates a single-use invite code through `POST /api/create-invite` (or the matching public RPC), then sends the code to the user over a trusted channel.
- `/signup` requires the organization slug, invite code, full name, NIC, optional phone, and email. `/api/start-signup` validates and consumes the invite, creates the account, and returns a randomly generated temporary password **once**.
- The temporary password is never derived from NIC data. NIC is staff-only identity data exposed only through the protected `tenant_users()` RPC.
- Email verification uses 6-digit codes stored as SHA-256 hashes in Postgres with a 10-minute expiry, 5 attempts, and a 60-second resend cooldown.
- The server enforces `email_verified` and `must_change_password` from `public.profiles`; the browser cannot bypass either gate.
- Legacy `api/signup-user.js` and `api/send-signup-link.js` are kept for compatibility but return `410 Gone`.
- Optional Cloudflare Turnstile protection can be enabled with server-only environment variables.
- Audit events are written to `public.audit_log`.

See `docs/MIGRATIONS.md` for the ordered database setup and `docs/GO_LIVE_CHECKLIST.md` for release steps.

## Requirements

- Node.js 20 or newer
- A Supabase project
- A Vercel account
- A Supabase pooled Postgres connection string (for media storage and provisioning fallback; the room importer itself uses REST)

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env`
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Set the server-only `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and
   `SUPABASE_JWKS_URL`
5. Start the app: `npm run dev`

The `api/` handlers use `@supabase/server/core` (`createAdminClient` and `verifyCredentials`).
JWTs are verified against `SUPABASE_JWKS_URL`, and elevated database access uses
`SUPABASE_SECRET_KEY`. Never add either secret to a `VITE_` variable.

### Running the API with the frontend

There is no separate server process. `npm run dev` starts Vite and its local `/api` middleware,
which runs the handlers in `api/` in the same process. Leave `VITE_API_BASE_URL` empty for local
development. For production on Vercel, the same `api/` files become the serverless functions.

## Email code verification

Signup now uses a 6-digit code instead of a magic link:

1. Signup creates the account with `email_verified = false` in `public.profiles` and sends the code.
2. `/api/send-code` stores only a SHA-256 hash in `public.email_verification_codes`, with a
   10-minute expiry, attempt count, and a 60-second resend cooldown.
3. `/api/verify-code` checks the hash (max 5 attempts), deletes the code on success, and sets
   `email_verified = true`. Login redirects unverified users to `/verify-email`.

First run [supabase/email-verification.sql](supabase/email-verification.sql) in the Supabase SQL
Editor. It adds the `email_verified` column and the server-only code table, and marks existing
users as verified.

SMTP settings use the existing `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and
`SMTP_FROM` variables. They are read only by the server-side handlers — never in React code.

Gmail App Password for local testing:

1. Turn on 2-Step Verification in your Google Account.
2. Open <https://myaccount.google.com/apppasswords>, choose **Mail** and **Windows Computer**
   (or **Other**), then generate the 16-character app password.
3. In `.env` set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`,
   `SMTP_USER=<your Gmail address>`, and `SMTP_PASS=<the app password without spaces>`.
4. Other providers work too, e.g. Brevo (`smtp-relay.brevo.com`) or Resend (`smtp.resend.com`),
   using their SMTP credentials and ports.

Test the endpoints directly while `npm run dev` is running:

```bash
curl -i -X POST http://127.0.0.1:5173/api/send-code \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","fullName":"Test User"}'

curl -i -X POST http://127.0.0.1:5173/api/verify-code \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","code":"123456"}'
```

Replace `123456` with the code from the email. Expected results: `200` on send, `200` on correct
verify, `400` on wrong/expired code, `429` on resend within 60 seconds or after 5 wrong attempts.

If SMTP is not configured in development, Nodemailer renders the message to JSON and the server
console prints the code with a `[DEV ONLY]` label. This never happens when `NODE_ENV=production`.
If `supabase/email-verification.sql` has not been run yet, the handlers fall back to an in-memory
store and print a warning; the code hashes still are never stored as plaintext.

Because the API is same-origin (Vite middleware locally, Vercel functions in production), no CORS
headers are needed. Both endpoints use an in-memory sliding-window rate limiter instead of
`express-rate-limit`, since there is no Express server.

## Supabase setup

1. Create a Supabase project.
2. For an existing project, run [supabase/apply-tenant-rpcs.sql](supabase/apply-tenant-rpcs.sql)
   once, then [supabase/fix-list-organization-users.sql](supabase/fix-list-organization-users.sql)
   and [supabase/user-management-rpcs.sql](supabase/user-management-rpcs.sql) once each.
   For a brand-new project, run [docs/platform.sql](docs/platform.sql) instead. Organization
   user details live in `org_<slug>.members`; `public.profiles` is only a small auth map.
   The server never gets grants inside tenant schemas. Then run
   [supabase/task-fields-and-start-times.sql](supabase/task-fields-and-start-times.sql)
   for task start times and named custom task fields, and
   [supabase/email-verification.sql](supabase/email-verification.sql) for 6-digit email codes.
   Verify with `npm run check:supabase`; `MISSING_RPCS` should print `(none)`.
   Using the Supabase CLI:

```powershell
supabase login
supabase init
supabase link --project-ref <YOUR-PROJECT-REF>
supabase db push
```
3. Create the first platform owner in Supabase Authentication.
   1. Open Supabase Authentication → Users.
   2. Create a user with the platform owner's email and password.
   3. Copy the Auth user UUID.
4. Insert the matching platform-owner profile:

```sql
insert into public.profiles (id, full_name, role, org_id, must_change_password)
values ('<YOUR-AUTH-USER-UUID>', 'Platform Owner', 'platform_admin', null, true);
```

5. Log in at `/login`:
   - Platform owner: leave the organization code empty and enter email/password.
   - Organization user: enter the organization slug/code, select the name from the dropdown,
     and enter the password.

The app is role-protected, but RLS in the schema remains the security boundary.

## Organization user tables

- `public.profiles` is a minimal auth map (`id`, `org_id`, `role`) for every user.
- `platform_admin` and `org_admin` keep `full_name`, `nic`, and `must_change_password` in
  `public.profiles`.
- `admin` and `cleaner` details (`full_name`, `nic`, `phone`, `role`, `is_active`,
  `must_change_password`, `created_at`) live only in `org_<slug>.members`.
- RLS lets a user read their own tenant row; `org_admin`/`admin` read and manage all rows in their
  own organization only. NIC is hidden from direct `authenticated` selects and is exposed only
  through the staff-only `tenant_users()` RPC.
- `service_role` has no privileges inside tenant schemas. Server writes use public
  security-definer RPCs such as `insert_tenant_user()` and `save_organization_rooms()`.

Tenant isolation can be checked in SQL Editor:

```sql
set local role authenticated;
set local request.jwt.claim.sub = '<cleaner-id-from-org-A>';
select id from org_mercuryfm.members;   -- own row only
select count(*) from org_other.members; -- 0 / no access
reset role;
```

## Password reset email setup

Supabase Authentication → SMTP Settings:

- For Brevo: use the SMTP host and port provided by Brevo, plus an SMTP login and SMTP key.
- For Resend: configure SMTP credentials from Resend or use the Resend Supabase integration.
- Set a verified sender address and sender name.
- Set the Site URL to the deployed Vercel domain.
- Add `https://<your-vercel-domain>/auth/callback` to Additional Redirect URLs.
- Add `http://127.0.0.1:5173/auth/callback` and `http://localhost:5173/auth/callback` when testing locally.
- Test Forgot password on `/login`; the link must open the callback and then `/reset-password`.
- Organization and platform recovery both use the same link; the app keeps the organization
  check on the reset screen.
- Phone/SMS authentication is disabled and not used by the login or recovery flows.

## Email link setup

Email verification and password recovery use single-use sign-in links instead of 6-digit codes.

- Keep Supabase Email (magic link) enabled.
- Copy `supabase/templates/magic-link.html` into Supabase Dashboard → Authentication →
  Templates → Magic Link. It includes the line “Your NIC number is your initial password.”
- If Supabase email delivery is not configured or fails, the app falls back to Node.js SMTP
  using the environment variables below.
- Every link redirects to `/auth/callback`, which reads the session and continues:
  - Signup: creates the profile through `/api/signup-user`.
  - First login: continues to `/change-password`.
  - Recovery: continues to `/reset-password`.
- Platform owner and organization admin sign in with email and password on their own pages.
- Phone/SMS verification must remain disabled.

### Node.js SMTP fallback for signup email

The signup page posts to `/api/send-signup-link`. If `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS`
are set, the API generates a Supabase magic link with `auth.admin.generateLink()` and sends it
with Nodemailer. If SMTP is not configured or sending fails, it falls back to Supabase's
`signInWithOtp()` sender.

Set these server-only variables in Vercel/local `.env`:

- `SMTP_HOST` — e.g. `smtp-relay.brevo.com` or `smtp.resend.com`
- `SMTP_PORT` — usually `587`
- `SMTP_USER` — Brevo login or `resend`
- `SMTP_PASS` — Brevo key or Resend API key
- `SMTP_FROM` — verified sender, e.g. `"Mercury FM" <no-reply@yourdomain.com>`
- `SMTP_SECURE` — `true` only for port 465; otherwise `false`

## Public signup with NIC

- Signup asks for organization ID, full name, NIC, and email.
- Signup sends a verification link instead of a code; clicking it creates the account.
- The emailed link tells the user that their NIC number is the initial password.
- When Node.js SMTP is configured, the email also shows the actual NIC value and tells the user
  to change it after the first login.
- The verified account uses the NIC as its initial password.
- The profile stores the NIC and `must_change_password=true`.
- On first login, the account verifies email and is routed to the password-change flow.
- Configure custom Brevo/Resend email templates to explicitly tell users:
  “Your NIC number is your initial password. Change it after login.”

## Vercel setup

Set these project environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_JWKS_URL`
- Optional signup email fallback: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`,
  `SMTP_SECURE`
- `SUPABASE_DB_URL` — use the **Session pooler** connection string from Supabase
  Dashboard → Connect → Connection string → Session pooler (port 5432). The direct
  `db.<project-ref>.supabase.co` host is IPv6-only and produces
  `getaddrinfo ENOTFOUND` on IPv4-only machines and Vercel functions. Room import no
  longer needs this value, but media storage and provisioning rollback still do.
  The database username must be `postgres.<project-ref>`, not `postgres`. TLS uses
  Supabase's public root CA (`certs/prod-ca-2021.crt`, embedded in
  `api/lib/supabaseCa.js`), so certificate verification stays enabled.

Deploy with `vercel.json`; it rewrites SPA routes to `index.html` and exposes serverless functions from `/api`.

## Organization provisioning

- Sign in with a `platform_admin`.
- Open `/platform`.
- Create an organization and organization admin.
- The `platform_admin` can also open **Rooms setup** and choose which organization to load.
- Upload branch/room CSV content in the format `branch_id,room_id`.
- Rooms are saved through the public `save_organization_rooms()` RPC with `SUPABASE_SECRET_KEY`.
  The service role has no grants inside tenant schemas. `rooms_locked=true` simply means rooms
  have been loaded at least once.
- Open **Rooms setup** to add, edit, or remove rooms at any time and save again.
- If the import reports the RPC is missing, run `supabase/apply-tenant-rpcs.sql` once.
- Manual fallback:

```sql
select public.provision_organization('Organization Name', 'organization_slug');
select public.refresh_exposed_schemas();
```

## Future organization migrations

Use a migration pattern that iterates active organization schemas:

```sql
create or replace function public.migrate_all_orgs()
returns void language plpgsql security definer set search_path = public as $$
declare
  org record;
begin
  for org in
    select schema_name
    from public.organizations
    where is_active
  loop
    execute format('alter table %I.example add column if not exists example_value text', org.schema_name);
  end loop;
end;
$$;
```

Replace the example statement with the reviewed migration for every tenant schema.

## Database media

Media is stored in each organization's `media` and `media_chunks` tables. Browser uploads use
`/api/media/start`, `/api/media/chunk`, and `/api/media/complete`. Media is served from
`/api/media/[id]` with server-side JWT and tenant authorization plus HTTP Range support.

## Running locally

Frontend:

```bash
npm install
npm run dev
```

Vercel serverless functions:

```bash
vercel dev
```

Set the server-only variables in a local `.env.local` or through `vercel dev`.
Never prefix `SUPABASE_SECRET_KEY` or `SUPABASE_DB_URL` with `VITE_`.

## Deployment checklist

1. Run `docs/platform.sql` once in the Supabase SQL Editor. For an existing project,
   run `supabase/apply-tenant-rpcs.sql` once instead. Then run
   `supabase/task-fields-and-start-times.sql` and `supabase/email-verification.sql`.
   Confirm with `npm run check:supabase`.
2. Create the first platform admin auth user and matching `profiles` row.
3. Configure every Vite and server-only environment variable in Vercel.
4. Deploy the application and test platform, org admin, admin, and cleaner login.
5. Provision a test organization and org admin.
6. Add branches and rooms, save, and confirm the room list loads correctly.
7. Add templates, assignments, tasks, and database media.
8. Run [docs/MANUAL_TEST_CHECKLIST.md](docs/MANUAL_TEST_CHECKLIST.md).
9. Run `supabase/email-verification.sql` and set the SMTP variables in Vercel.

## Excel imports for templates and rooms

- On **Templates**, choose **Sample Excel** to download the expected workbook, or **Import Excel**
  to create a template from a filled sheet.
- Task sheets need a `Task name` and a `Finish time` column; `Start time` is optional.
- Any other header becomes a named custom field on that task (for example `Room notes`), and its
  cell value becomes the field's default value. Cleaners can fill these values on their task cards.
- On **Branches and rooms**, Excel sheets need `branch_id` and `room_id` columns. CSV is still
  supported with the same headers.

## Before production: email verification

- Run `supabase/email-verification.sql` so codes are stored in Postgres and survive restarts.
- Remove the in-memory fallback in `api/lib/emailVerification.js` once every environment has the
  table, or keep it only for local development.
- Configure real SMTP credentials and set `NODE_ENV=production` so the dev console fallback is off.
- Move the rate-limit Map to Redis or a shared table if you run more than one serverless instance.
- Add a scheduled cleanup job for expired rows in `public.email_verification_codes`.
- Keep `SUPABASE_SECRET_KEY` and SMTP passwords server-side only; never use a `VITE_` prefix.
- Consider requiring a verified email again when a user changes their email address.
- Decide what happens to unverified accounts after a set period (for example, delete them).

## Quality gates and handoff docs

Run these before every release:

```bash
npm run lint
npm test
npm run build
npm run test:e2e   # after: npx playwright install chromium
npm run audit:prod
npm run check:supabase
```

- `npm run lint` uses the flat config in `eslint.config.js`; `npm run format` applies Prettier.
- `npm test` runs Vitest unit tests in `tests/`. `npm run test:e2e` runs Playwright smoke tests in `tests/e2e/`.
- `.github/workflows/ci.yml` runs lint, unit tests, build, production audit, and smoke tests on pushes and pull requests.
- `docs/MIGRATIONS.md` — ordered baseline scripts and timestamped migrations, all forward-only.
- `docs/rls-tests.sql` — read-only authorization checks to run in the Supabase SQL Editor.
- `docs/ADMIN_GUIDE.md` and `docs/CLEANER_GUIDE.md` — role-specific user guides.
- `docs/RUNBOOK.md` — common production incidents and safe responses.
- `docs/GO_LIVE_CHECKLIST.md` — final release checklist.
- `docs/SECURITY_SETUP.md` — security configuration and credential handling.
- `CHANGES.md` — item-by-item record of what was already present and what was added in this pass.

