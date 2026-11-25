# Security audit — Mercury FM

Date: 2026-11-24
Scope: `E:\KenWeb\MercuryFm\site` (React/Vite + `api/` serverless handlers + Supabase)

## Tools used

| Tool | Command | Result |
| --- | --- | --- |
| npm audit | `npm audit --json`, `npm audit --omit=dev --json` | 42 total (1 critical / 21 high / 19 moderate / 1 low); **prod-only: 5 moderate** |
| gitleaks | `gitleaks detect --source . --no-git` | 13 hits: 3 in `.env`, 10 in tool/library docs (false positives) |
| Semgrep | `semgrep scan --config auto` | 71 hits: 66 in vendored agent skills (out of scope), 5 in `api/` |
| Trivy | `trivy fs --scanners vuln,secret,misconfig` | 2 medium (glob, minimatch); no secrets, no misconfigs |

Raw reports are in gitignored `.audit-reports/`.

## Findings

### HIGH — TLS certificate verification disabled on database connections

**Locations:** `api/create-organization.js:123`, `api/media/_tenant.js:49`

Both Postgres pools are created with `ssl: { rejectUnauthorized: false }`. This accepts any certificate, so an attacker able to intercept the route to Supabase could impersonate the database and read or modify credentials, profiles, and tenant media. These connections run with the service-level `SUPABASE_SECRET_KEY`/database password, so impact is high.

**Fix:** use verified TLS (`ssl: { rejectUnauthorized: true }`). Supabase DB/pooler hosts present trusted certificates, so no customer functionality should change. Requires confirming the current `SUPABASE_DB_URL` reaches a trusted host (the previously recorded direct host had DNS/auth problems; a Session pooler URL may be needed).

### MEDIUM — Stored XSS via SVG media served inline

**Locations:** `api/media/start.js:30-37`, `api/media/[id].js:63-66`

`mimeType` is supplied by the caller and only prefix-checked (`image/` or `video/`). `image/svg+xml` passes. The download handler serves the stored bytes with `Content-Disposition: inline` and the caller-supplied MIME type on the app's origin. A cleaner can upload an SVG containing `<script>` and have it execute when an admin views the media, enabling session/token theft and cross-tenant actions.

**Fix:**
- Strict MIME allowlist in `start.js` (e.g. `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/webm`).
- `X-Content-Type-Options: nosniff` and a restrictive `Content-Security-Policy` on media responses.

### MEDIUM — Production dependency vulnerabilities (5 moderate)

Unused production dependency `googleapis` pulls in `gaxios`, `googleapis-common`, `glob`, `minimatch`, and `rimraf`, all with fixable advisories. No app code imports `googleapis`. Removing it clears all five.

### MEDIUM — Development dependency vulnerabilities (37, incl. 1 critical / 21 high)

Almost all come from the `vercel` CLI devDependency (`@vercel/*`, `undici`, `ajv`, `tar`, `esbuild`, etc.). Not deployed to the browser or API runtime, but a risk on developer machines/CI. Resolve with `npm audit fix` and, if needed, a `vercel` upgrade.

### HIGH (operational) — Credentials exposed in chat / local `.env`

Supabase DB password, Gmail app password, and Brevo SMTP key were pasted into the conversation, and `.env` contains live Supabase publishable/secret keys. `.env` is gitignored, so it is not in a commit, but exposed secrets must be rotated:

1. Supabase database password (and update `SUPABASE_DB_URL`).
2. Gmail app password (if still enabled).
3. Brevo SMTP key (and update `SMTP_PASS`).
4. Supabase `SUPABASE_SECRET_KEY` / legacy service-role key if it was ever shared.

### LOW — Non-literal format string in log

`api/platform-users.js:76` uses a template literal in `console.warn`. The interpolated value is a UUID, so practical risk is negligible; switch to `console.warn('...', org.id, e)` for log hygiene.

### Informational / false positives

- 66 Semgrep ReDoS/prototype-pollution findings are in vendored `.agents/`, `.claude/`, and `agent/` skill copies, not application code.
- 10 gitleaks hits are in gitleaks' own README and Python libraries (`.venv`).
- Trivy found no secrets or misconfigurations.
- `api/media/[id].js:89,96` "direct response write" warnings are the binary media body; the real risk is the SVG/MIME issue above, not classic HTML XSS.
- `api/verify-code.js` and `api/lib/emailVerification.js` already enforce 6-digit format, 5 attempts, 60s resend cooldown, 10-min expiry, SHA-256-only storage, and per-IP rate limits — no finding.

## Fixes applied

1. **HIGH — TLS:** added `api/lib/dbPool.js`, which strips all SSL parameters from `SUPABASE_DB_URL` and pins `ssl: { ca: SUPABASE_CA, rejectUnauthorized: true }`. The public Supabase root CA lives in `certs/prod-ca-2021.crt` and is embedded in `api/lib/supabaseCa.js` so Vercel bundles it. Both `api/create-organization.js` and `api/media/_tenant.js` use this pool. No `rejectUnauthorized: false` remains in `api/`.
2. **MEDIUM — media XSS:** `api/media/start.js` now allows only `image/jpeg|png|webp|gif` and `video/mp4|webm|quicktime|x-m4v|3gpp` (normalised, case-insensitive, parameters stripped). `api/media/[id].js` sends `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.
3. **MEDIUM — dependencies:** removed the unused `googleapis` dependency. Production dependency audit is now **0 vulnerabilities**.
4. **LOW — logging:** `api/platform-users.js` now passes the org id as a separate `console.warn` argument.

## Residual items (user action required)

- **Rotate exposed credentials:** Supabase DB password, Gmail app password, Brevo SMTP key, and any shared Supabase secret key. `.env` is gitignored, so the 3 gitleaks hits there are local-config findings, not committed secrets; app source directories (`api`, `src`, `scripts`, `docs`, `supabase`) scan clean.
- **Dev-only advisories:** 39 advisories (1 critical, 21 high) remain in the `vercel` CLI devDependency. None ship to the browser or API runtime. npm's only suggested fix is a semver-major downgrade to `vercel@65.2.0`, which was not applied because it could break the local `vercel dev` workflow. Review before downgrading.
- Run `supabase/user-management-rpcs.sql` in the Supabase SQL Editor if the user-management RPCs are still missing. `npm run check:supabase` still reports: `MISSING_RPCS: update_tenant_user_role, get_tenant_user_nic, set_tenant_user_must_change_password`.
- Confirm Brevo email delivery and the login / change-password / verification flow.
- **Reset the Supabase database password.** The password currently in `.env` returns `28P01` (password authentication failed) on the Session pooler. Reset it in Supabase Dashboard → Database → Database password, then copy the new Session pooler connection string into `SUPABASE_DB_URL`. The host has been corrected to `aws-0-ap-northeast-1.pooler.supabase.com:5432` with user `postgres.plzsxjiimgdcluaedxrp`.
- Smoke-test media upload/download and organization provisioning after the DB URL/TLS change. TLS verification against the Supabase CA was confirmed (the connection reaches password authentication instead of failing certificate validation).

## Verification after fixes

| Check | Result |
| --- | --- |
| `npm run build` | Pass (only the pre-existing >500 kB chunk warning) |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| gitleaks on `api`, `src`, `scripts`, `docs`, `supabase` | **0 leaks** |
| Semgrep (app code only) | 2 findings, both binary media `response.send()` false positives mitigated by the MIME allowlist, `nosniff`, and CSP sandbox |
| Trivy (prod deps only) | 0 vulnerabilities, 0 secrets, 0 misconfigurations |
| `grep rejectUnauthorized: false` in `api/` | No matches |
