import { getAdminClient, verifyUser } from '../lib/serverSupabase.js'

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

  const { data: callerProfile, error: callerProfileError } = await serverClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (callerProfileError || callerProfile?.role !== 'platform_admin') {
    return json(response, 403, { error: 'Platform admin access required' })
  }

  const { data: organizations, error: organizationsError } = await serverClient
    .from('organizations')
    .select('id, name, slug, schema_name, is_active, rooms_locked, created_at')
    .order('name')
  if (organizationsError) {
    console.error('organization-details list failed', organizationsError)
    return json(response, 400, { error: 'Could not load organizations' })
  }

  const organizationIds = (organizations || []).map((organization) => organization.id)
  const { data: orgProfiles, error: profilesError } = await serverClient
    .from('profiles')
    .select('id, full_name, role, org_id')
    .eq('role', 'org_admin')
    .in('org_id', organizationIds)
  if (profilesError) {
    console.error('organization-details profiles failed', profilesError)
    return json(response, 400, { error: 'Could not load organization admins' })
  }

  const { data: authUsers, error: authUsersError } =
    await serverClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (authUsersError) {
    return json(response, 400, { error: 'Could not load organization admin emails' })
  }

  const authById = new Map(
    (authUsers.users || []).map((authUser) => [authUser.id, authUser]),
  )
  const adminByOrgId = new Map()
  for (const profile of orgProfiles || []) {
    const authUser = authById.get(profile.id)
    adminByOrgId.set(profile.org_id, {
      fullName: profile.full_name,
      email: authUser?.email || null,
    })
  }

  return json(response, 200, {
    organizations: (organizations || []).map((organization) => ({
      ...organization,
      orgAdmin: adminByOrgId.get(organization.id) || null,
    })),
  })
}
