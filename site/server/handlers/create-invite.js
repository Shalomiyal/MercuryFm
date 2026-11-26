import { getAdminClient, verifyUser } from '../lib/serverSupabase.js'
import { generateInviteCode, hashInviteCode } from '../lib/invites.js'
import { rateLimit, clientIp } from '../lib/emailVerification.js'
import { writeAuditLog } from '../lib/audit.js'
import { sendRateLimited } from '../lib/rateLimit.js'

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return json(response, 405, { error: 'Method not allowed' })
  }
  const { client, error: configError } = getAdminClient()
  if (configError) {
    return json(response, 500, { error: 'Supabase server configuration is missing' })
  }
  const { userId, profile: callerProfile, error: authError } = await verifyUser(request)
  if (authError) return json(response, authError.status, { error: authError.message })

  const isPlatformAdmin = callerProfile?.role === 'platform_admin'
  const isOrgAdmin = callerProfile?.role === 'org_admin'
  if (!isPlatformAdmin && !isOrgAdmin) {
    return json(response, 403, { error: 'Admin access required' })
  }

  const limit = await rateLimit(`invite-ip:${clientIp(request)}`, 30, 60 * 60 * 1000)
  if (limit.limited) {
    return sendRateLimited(response, limit.retryAfter, {
      error: 'Too many invite codes were created. Please try again later.',
    })
  }

  const { organizationId, role = 'cleaner', email, expiresInHours = 72 } = request.body || {}
  if (!['admin', 'cleaner'].includes(role)) {
    return json(response, 400, { error: 'Invite role must be admin or cleaner' })
  }
  const hours = Number(expiresInHours)
  if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 30) {
    return json(response, 400, { error: 'Invite expiry must be between 1 and 720 hours' })
  }
  let targetOrgId = callerProfile.org_id
  if (isPlatformAdmin) {
    targetOrgId = organizationId
  } else if (organizationId && organizationId !== callerProfile.org_id) {
    return json(response, 403, { error: 'You can only invite users to your own organization' })
  }
  if (!targetOrgId) {
    return json(response, 400, { error: 'Choose an organization before creating an invite' })
  }

  const { data: organization, error: orgError } = await client
    .from('organizations')
    .select('id, is_active')
    .eq('id', targetOrgId)
    .maybeSingle()
  if (orgError) {
    console.error('create-invite organization lookup failed', orgError)
    return json(response, 400, { error: 'Could not check the organization' })
  }
  if (!organization?.is_active) {
    return json(response, 404, { error: 'Organization not found or inactive' })
  }

  const inviteCode = generateInviteCode()
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
  const { data: inviteId, error: insertError } = await client.rpc('create_organization_invite', {
    p_org_id: targetOrgId,
    p_code_hash: hashInviteCode(inviteCode),
    p_email: email ? String(email).trim().toLowerCase() : null,
    p_role: role,
    p_expires_at: expiresAt,
    p_created_by: userId,
  })
  if (insertError || !inviteId) {
    console.error('create-invite insert failed', insertError)
    return json(response, 500, { error: 'Could not create the invite code' })
  }

  await writeAuditLog({
    actorId: userId,
    action: 'invite_created',
    orgId: targetOrgId,
    metadata: { invite_id: inviteId, role, expires_at: expiresAt },
  })

  return json(response, 201, { inviteCode, expiresAt, organizationId: targetOrgId, role })
}
