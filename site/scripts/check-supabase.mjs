import fs from 'node:fs'

const envPath = new URL('../.env', import.meta.url)
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    }),
)

const url = env.SUPABASE_URL
const key = env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env')
  process.exit(1)
}

const headers = { apikey: key, Authorization: `Bearer ${key}` }

async function restGet(path, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(`${url}${path}`, {
        headers,
        signal: AbortSignal.timeout(30000),
      })
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      }
    }
  }
  throw lastError
}

async function restJson(path) {
  const response = await restGet(path)
  return response.json()
}

console.log('SUPABASE_URL:', url)

const organizationsResponse = await restGet('/rest/v1/organizations?select=id&limit=1')
const organizationsBody = await organizationsResponse.text()
console.log('GET /rest/v1/organizations:', organizationsResponse.status, organizationsBody)
let firstOrgId = null
try {
  firstOrgId = JSON.parse(organizationsBody)[0]?.id || null
} catch {
  firstOrgId = null
}

const codes = await restGet('/rest/v1/email_verification_codes?select=email&limit=1')
console.log('GET /rest/v1/email_verification_codes:', codes.status, await codes.text())

if (firstOrgId) {
  const rpc = await fetch(`${url}/rest/v1/rpc/list_organization_users`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_org_id: firstOrgId }),
    signal: AbortSignal.timeout(30000),
  })
  console.log('RPC list_organization_users:', rpc.status, (await rpc.text()).slice(0, 300))
}

const catalog = await restJson('/rest/v1/')
const availableRpcs = new Set(
  Object.keys(catalog.paths || {})
    .filter((path) => path.startsWith('/rpc/'))
    .map((path) => path.slice('/rpc/'.length)),
)
const requiredRpcs = [
  'in_org',
  'is_org_staff',
  'my_org_id',
  'is_platform_admin',
  'my_role',
  'my_schema',
  'refresh_exposed_schemas',
  'provision_organization',
  'ensure_tenant_members',
  'sync_tenant_members',
  'my_tenant_user',
  'tenant_users',
  'mark_password_changed',
  'list_organization_users',
  'insert_tenant_user',
  'list_organization_rooms',
  'save_organization_rooms',
  'update_tenant_user_role',
  'get_tenant_user_nic',
  'set_tenant_user_must_change_password',
]
const missingRpcs = requiredRpcs.filter((name) => !availableRpcs.has(name))
console.log('MISSING_RPCS:', missingRpcs.length ? missingRpcs.join(', ') : '(none)')
