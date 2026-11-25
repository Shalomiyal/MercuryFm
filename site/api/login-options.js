import { getAdminClient, verifyUser } from './lib/serverSupabase.js'

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

// Public organization lookup. Staff details are only returned to verified,
// active members of that same organization.
export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return json(response, 405, { error: 'Method not allowed' })
  }

  const slug = String(request.query.slug || '')
    .trim()
    .toLowerCase()
  if (!/^[a-z0-9_]{2,30}$/.test(slug)) {
    return json(response, 400, { error: 'Enter a valid organization code' })
  }

  const { client: serverClient, error: configError } = getAdminClient()
  if (configError) {
    return json(response, 500, { error: 'Server authentication is not configured' })
  }

  const { data: organization, error: organizationError } = await serverClient
    .from('organizations')
    .select('id, name, slug, is_active')
    .eq('slug', slug)
    .maybeSingle()
  if (organizationError) {
    console.error('login-options organization lookup failed', organizationError)
    return json(response, 400, { error: 'Could not check the organization code' })
  }
  if (!organization || !organization.is_active) {
    return json(response, 404, { error: 'Organization code not found or inactive' })
  }

  const publicOrganization = {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
  }
  const { userId, error: authError } = await verifyUser(request)
  if (authError || !userId) {
    return json(response, 200, { organization: publicOrganization, users: [] })
  }

  const { data: callerProfile, error: profileError } = await serverClient
    .from('profiles')
    .select('role, org_id')
    .eq('id', userId)
    .maybeSingle()
  if (profileError || callerProfile?.org_id !== organization.id ||
      !['org_admin', 'admin'].includes(callerProfile?.role)) {
    return json(response, 200, { organization: publicOrganization, users: [] })
  }

  const { data: tenantUsers, error: tenantUsersError } = await serverClient.rpc(
    'list_organization_users',
    { p_org_id: organization.id },
  )
  if (tenantUsersError) {
    console.error('login-options tenant lookup failed', tenantUsersError)
    return json(response, 200, { organization: publicOrganization, users: [] })
  }

  const users = (tenantUsers || []).map((user) => ({
    id: user.id,
    fullName: user.full_name,
    role: user.role,
  }))
  return json(response, 200, { organization: publicOrganization, users })
}
