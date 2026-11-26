import { getAdminClient, verifyUser } from '../lib/serverSupabase.js'
import { writeAuditLog } from '../lib/audit.js'
import { cacheDelete } from '../lib/cache.js'

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return json(response, 405, { error: 'Method not allowed' })
  }
  const { client: serverClient, error: configError } = getAdminClient()
  if (configError) {
    return json(response, 500, { error: 'Server authentication is not configured' })
  }
  const { userId, error: authError } = await verifyUser(request)
  if (authError) return json(response, authError.status, { error: authError.message })
  const { data: callerProfile, error: profileError } = await serverClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (profileError || callerProfile?.role !== 'platform_admin') {
    return json(response, 403, { error: 'Platform admin access required' })
  }

  const { organizationId, isActive } = request.body || {}
  if (!organizationId || typeof isActive !== 'boolean') {
    return json(response, 400, { error: 'Organization ID and isActive are required' })
  }
  const { data: organization, error: organizationError } = await serverClient
    .from('organizations')
    .select('id, slug, is_active')
    .eq('id', organizationId)
    .maybeSingle()
  if (organizationError) {
    console.error('set-organization-active lookup failed', organizationError)
    return json(response, 400, { error: 'Could not check the organization' })
  }
  if (!organization) return json(response, 404, { error: 'Organization not found' })
  const { error: updateError } = await serverClient
    .from('organizations')
    .update({ is_active: isActive })
    .eq('id', organizationId)
  if (updateError) {
    console.error('set-organization-active update failed', updateError)
    return json(response, 400, { error: 'Could not update the organization' })
  }

  const { error: refreshError } =
    await serverClient.rpc('refresh_exposed_schemas')
  if (refreshError) {
    await serverClient
      .from('organizations')
      .update({ is_active: organization.is_active })
      .eq('id', organizationId)
    console.error('set-organization-active refresh failed', refreshError)
    return json(response, 400, { error: 'Could not refresh organization access' })
  }
  await cacheDelete(`org:${organization.slug}`)
  await writeAuditLog({
    actorId: userId,
    action: isActive ? 'organization_activated' : 'organization_deactivated',
    orgId: organizationId,
  })
  return json(response, 200, { isActive })
}
