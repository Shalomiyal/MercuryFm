import { getAdminClient, verifyUser } from '../lib/serverSupabase.js'
import { generateTemporaryPassword } from '../lib/passwords.js'
import { writeAuditLog } from '../lib/audit.js'

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

const ACTIONS = ['update_role', 'delete', 'reset_password']

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return json(response, 405, { error: 'Method not allowed' })
  }

  const { client: serverClient, error: configError } = getAdminClient()
  if (configError) {
    return json(response, 500, { error: 'Supabase server configuration is missing' })
  }

  const { userId: callerId, error: authError } = await verifyUser(request)
  if (authError) return json(response, authError.status, { error: authError.message })

  const { data: callerProfile, error: callerProfileError } = await serverClient
    .from('profiles')
    .select('role, org_id')
    .eq('id', callerId)
    .maybeSingle()

  const isPlatformAdmin = callerProfile?.role === 'platform_admin'
  const isOrgAdmin = callerProfile?.role === 'org_admin' && Boolean(callerProfile.org_id)
  if (callerProfileError || (!isPlatformAdmin && !isOrgAdmin)) {
    return json(response, 403, { error: 'Admin access required' })
  }

  const { action, userId, role } = request.body || {}
  if (!ACTIONS.includes(action) || !userId) {
    return json(response, 400, { error: 'Invalid user management request' })
  }
  if (userId === callerId) {
    return json(response, 400, { error: 'You cannot change your own account here' })
  }

  const { data: targetProfile, error: targetError } = await serverClient
    .from('profiles')
    .select('id, role, org_id')
    .eq('id', userId)
    .maybeSingle()
  if (targetError) {
    console.error('manage-user target lookup failed', targetError)
    return json(response, 400, { error: 'Could not load that user' })
  }
  if (!targetProfile) {
    return json(response, 404, { error: 'User not found' })
  }
  if (!isPlatformAdmin && targetProfile.org_id !== callerProfile.org_id) {
    return json(response, 404, { error: 'User not found in this organization' })
  }
  if (!isPlatformAdmin && !['admin', 'cleaner'].includes(targetProfile.role)) {
    return json(response, 400, {
      error: 'Only admin and cleaner accounts can be managed here',
    })
  }

  const targetOrgId = isPlatformAdmin ? targetProfile.org_id : callerProfile.org_id

  if (action === 'update_role') {
    const allowedRoles = isPlatformAdmin
      ? ['org_admin', 'admin', 'cleaner']
      : ['admin', 'cleaner']
    if (!allowedRoles.includes(role)) {
      return json(response, 400, { error: `Role must be one of: ${allowedRoles.join(', ')}` })
    }
    if (role === targetProfile.role) {
      return json(response, 200, { message: 'Role is already up to date' })
    }

    // org_admin is a public-profile role only; it has no tenant member row.
    if (targetOrgId && role !== 'org_admin') {
      const { error: tenantRoleError } = await serverClient.rpc('update_tenant_user_role', {
        p_org_id: targetOrgId,
        p_user_id: userId,
        p_role: role,
      })
      if (tenantRoleError && !isPlatformAdmin) {
        console.error('manage-user tenant role update failed', tenantRoleError)
        return json(response, 400, { error: 'Could not update the organization role' })
      }
    }

    const { error: profileError } = await serverClient
      .from('profiles')
      .update({ role })
      .eq('id', userId)
    if (profileError) {
      if (targetOrgId && role !== 'org_admin') {
        await serverClient.rpc('update_tenant_user_role', {
          p_org_id: targetOrgId,
          p_user_id: userId,
          p_role: targetProfile.role,
        }).catch(() => {})
      }
      console.error('manage-user profile role update failed', profileError)
      return json(response, 400, { error: 'Could not update the account role' })
    }

    await writeAuditLog({
      actorId: callerId,
      action: 'user_role_updated',
      orgId: targetOrgId,
      targetUserId: userId,
      metadata: { from: targetProfile.role, to: role },
    })
    return json(response, 200, { message: `Role updated to ${role}` })
  }

  if (action === 'reset_password') {
    const tempPassword = generateTemporaryPassword()
    const { error: passwordError } = await serverClient.auth.admin.updateUserById(userId, {
      password: tempPassword,
    })
    if (passwordError) {
      console.error('manage-user password reset failed', passwordError)
      return json(response, 400, { error: 'Could not reset the password' })
    }

    if (targetOrgId && roleIsTenant(targetProfile.role)) {
      await serverClient.rpc('set_tenant_user_must_change_password', {
        p_org_id: targetOrgId,
        p_user_id: userId,
        p_must_change_password: true,
      }).catch((error) => {
        console.warn('manage-user tenant password flag update failed:', error?.message || error)
      })
    }
    if (targetProfile.role === 'org_admin') {
      await serverClient
        .from('profiles')
        .update({ must_change_password: true })
        .eq('id', userId)
    }

    await writeAuditLog({
      actorId: callerId,
      action: 'user_password_reset',
      orgId: targetOrgId,
      targetUserId: userId,
    })
    return json(response, 200, {
      message: 'Password reset. Share the temporary password securely and require a change at first login.',
      tempPassword,
    })
  }

  const { error: deleteError } = await serverClient.auth.admin.deleteUser(userId)
  if (deleteError) {
    console.error('manage-user delete failed', deleteError)
    return json(response, 400, { error: 'Could not delete the user' })
  }

  await writeAuditLog({
    actorId: callerId,
    action: 'user_deleted',
    orgId: targetOrgId,
    targetUserId: userId,
  })
  return json(response, 200, { message: 'User deleted' })
}

function roleIsTenant(role) {
  return ['admin', 'cleaner'].includes(role)
}
