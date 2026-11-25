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

  const { data: callerProfile, error: callerProfileError } = await serverClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (callerProfileError || callerProfile?.role !== 'platform_admin') {
    return json(response, 403, { error: 'Platform admin access required' })
  }

  try {
    const [orgsResult, profilesResult, authUsersResult] = await Promise.all([
      serverClient
        .from('organizations')
        .select('id, name, slug, schema_name, is_active')
        .order('name'),
      serverClient
        .from('profiles')
        .select('id, full_name, role, org_id, must_change_password, email_verified')
        .order('role'),
      serverClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ])

    if (orgsResult.error) {
      console.error('organizations query error:', orgsResult.error)
      return json(response, 400, { error: 'Could not load organizations' })
    }
    if (profilesResult.error) {
      console.error('profiles query error:', profilesResult.error)
      return json(response, 400, { error: 'Could not load user profiles' })
    }
    if (authUsersResult.error) {
      console.error('authUsers query error:', authUsersResult.error)
      return json(response, 400, { error: 'Could not load account emails' })
    }

    const organizations = orgsResult.data || []
    const profiles = profilesResult.data || []
    const authUsers = authUsersResult.data?.users || []

    const orgMap = new Map(organizations.map((org) => [org.id, org]))
    const authMap = new Map(authUsers.map((user) => [user.id, user]))

    // Map tenant details for each organization (full_name, phone)
    const tenantUserMap = new Map()
    await Promise.all(
      organizations.map(async (org) => {
        try {
          const { data: tenantUsers, error: rpcError } = await serverClient.rpc('list_organization_users', {
            p_org_id: org.id,
          })
          if (!rpcError && tenantUsers) {
            for (const tu of tenantUsers) {
              tenantUserMap.set(tu.id, tu)
            }
          }
        } catch (e) {
          console.warn('list_organization_users failed for org', org.id, e)
        }
      }),
    )

    const users = profiles.map((p) => {
      const authUser = authMap.get(p.id)
      const org = orgMap.get(p.org_id)
      const tenantData = tenantUserMap.get(p.id)

      const fullName =
        tenantData?.full_name ||
        p.full_name ||
        authUser?.user_metadata?.full_name ||
        '—'

      return {
        id: p.id,
        fullName,
        email: authUser?.email || '—',
        phone: tenantData?.phone || null,
        role: p.role,
        orgId: p.org_id || null,
        organizationName: org?.name || (p.role === 'platform_admin' ? 'Platform' : 'Unassigned'),
        organizationSlug: org?.slug || null,
        emailVerified: p.email_verified ?? (authUser?.email_confirmed_at != null),
        mustChangePassword: p.must_change_password ?? false,
        createdAt: authUser?.created_at || null,
        lastSignInAt: authUser?.last_sign_in_at || null,
      }
    })

    return json(response, 200, { users, organizations })
  } catch (error) {
    console.error('platform-users error:', error)
    return json(response, 500, { error: 'Could not load platform users' })
  }
}
