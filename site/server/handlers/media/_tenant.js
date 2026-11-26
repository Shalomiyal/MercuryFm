import { getAdminClient, verifyUser } from '../../lib/serverSupabase.js'
import { createDbPool } from '../../lib/dbPool.js'

export function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

export function serverConfig() {
  return { dbUrl: process.env.SUPABASE_DB_URL }
}

export async function verifyTenantCaller(request) {
  const { client: serverClient, error: configError } = getAdminClient()
  if (configError) {
    throw Object.assign(new Error('Supabase server configuration is missing'), { status: 500 })
  }
  const { userId, error: authError } = await verifyUser(request)
  if (authError) {
    throw Object.assign(new Error(authError.message), { status: authError.status })
  }
  const { data: profile, error: profileError } = await serverClient
    .from('profiles')
    .select('id, role, org_id')
    .eq('id', userId)
    .maybeSingle()
  if (profileError || !profile) {
    throw Object.assign(new Error('User profile not found'), { status: 403 })
  }
  if (profile.role === 'platform_admin') {
    throw Object.assign(new Error('Organization access required'), { status: 403 })
  }
  const { data: organization, error: orgError } = await serverClient
    .from('organizations')
    .select('id, schema_name, is_active')
    .eq('id', profile.org_id)
    .maybeSingle()
  if (orgError || !organization?.is_active) {
    throw Object.assign(new Error('Organization is unavailable'), { status: 403 })
  }
  return { userId, profile, organization }
}

export function poolForDb() {
  const { dbUrl } = serverConfig()
  if (!dbUrl) throw Object.assign(new Error('SUPABASE_DB_URL is missing'), { status: 500 })
  return createDbPool(dbUrl)
}

export function pgIdent(value) {
  return `"${value.replace(/"/g, '""')}"`
}
