import { getAdminClient, verifyUser } from './lib/serverSupabase.js'

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return json(response, 405, { error: 'Method not allowed' })
  }

  const { client: serverClient, error: configError } = getAdminClient()
  if (configError) {
    return json(response, 500, { error: 'Supabase server configuration is missing' })
  }
  const { userId, error: authError } = await verifyUser(request)
  if (authError) return json(response, authError.status, { error: authError.message })
  const { data: profile, error: profileError } = await serverClient
    .from('profiles')
    .select('role, org_id')
    .eq('id', userId)
    .maybeSingle()
  if (profileError || !profile) {
    return json(response, 403, { error: 'Could not verify your profile' })
  }
  if (!['platform_admin', 'org_admin'].includes(profile.role)) {
    return json(response, 403, { error: 'Platform admin or organization admin access required' })
  }

  let targetOrgId = profile.org_id
  if (profile.role === 'platform_admin') {
    targetOrgId = request.query?.organizationId
    if (!targetOrgId) {
      return json(response, 400, { error: 'Choose an organization' })
    }
  } else if (request.query?.organizationId && request.query.organizationId !== profile.org_id) {
    return json(response, 403, { error: 'You can only view your own organization' })
  }

  const { data: organization, error: orgError } = await serverClient
    .from('organizations')
    .select('id, schema_name, rooms_locked')
    .eq('id', targetOrgId)
    .maybeSingle()
  if (orgError) {
    console.error('list-rooms organization lookup failed', orgError)
    return json(response, 400, { error: 'Could not check the organization' })
  }
  if (!organization) return json(response, 404, { error: 'Organization not found' })

  const { data, error } = await serverClient.rpc('list_organization_rooms', {
    p_org_id: organization.id,
  })
  if (error) {
    console.error('list-rooms RPC failed', error)
    return json(response, 400, { error: 'Could not load rooms for this organization' })
  }

  return json(response, 200, {
    branches: data?.branches || [],
    rooms: data?.rooms || [],
    roomsLocked: data?.roomsLocked ?? organization.rooms_locked,
  })
}
