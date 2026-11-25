import { getAdminClient, verifyUser } from './lib/serverSupabase.js'
import { generateTemporaryPassword } from './lib/passwords.js'
import { issueCode, isValidEmail, normalizeEmail } from './lib/emailVerification.js'
import { writeAuditLog } from './lib/audit.js'

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
    return json(response, 500, { error: 'Supabase server configuration is missing' })
  }
  const { userId: callerId, error: authError } = await verifyUser(request)
  if (authError) return json(response, authError.status, { error: authError.message })
  const { data: callerProfile, error: callerProfileError } = await serverClient
    .from('profiles')
    .select('role, org_id')
    .eq('id', callerId)
    .maybeSingle()
  if (callerProfileError || callerProfile?.role !== 'org_admin') {
    return json(response, 403, { error: 'Organization admin access required' })
  }

  const { fullName, email, role, phone } = request.body || {}
  const normalizedEmail = normalizeEmail(email)
  if (!fullName?.trim() || !isValidEmail(normalizedEmail) ||
      !['admin', 'cleaner'].includes(role)) {
    return json(response, 400, {
      error: 'Full name, a valid email address, and role (admin or cleaner) are required',
    })
  }
  if (!callerProfile.org_id) {
    return json(response, 403, { error: 'Organization admin has no organization' })
  }

  const { data: organization, error: organizationError } = await serverClient
    .from('organizations')
    .select('schema_name')
    .eq('id', callerProfile.org_id)
    .maybeSingle()
  if (organizationError || !organization?.schema_name) {
    console.error('create-user organization lookup failed', organizationError)
    return json(response, 400, { error: 'Organization schema not found' })
  }

  const tempPassword = generateTemporaryPassword()
  const { data: authData, error: createError } =
    await serverClient.auth.admin.createUser({
      email: normalizedEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: String(fullName).trim() },
    })
  if (createError) {
    console.error('create-user auth create failed', createError)
    return json(response, 400, { error: 'Could not create the account. Check the email address and try again.' })
  }

  const authUserId = authData.user.id
  const rollback = async (message) => {
    await serverClient.auth.admin.deleteUser(authUserId).catch(() => {})
    return json(response, 400, { error: message })
  }

  // Minimal public map. Full details, including the NIC, live in the tenant
  // schema only. The NIC is identity data and is never used as a password.
  const { error: profileError } = await serverClient
    .from('profiles')
    .insert({
      id: authUserId,
      role,
      org_id: callerProfile.org_id,
      email_verified: false,
      full_name: null,
      nic: null,
      must_change_password: null,
    })
  if (profileError) return rollback('User profile creation failed')

  const { error: tenantUserError } = await serverClient.rpc('insert_tenant_user', {
    p_org_id: callerProfile.org_id,
    p_id: authUserId,
    p_full_name: String(fullName).trim(),
    p_nic: null,
    p_phone: String(phone || '').trim() || null,
    p_role: role,
    p_must_change_password: true,
  })
  if (tenantUserError) return rollback('Organization user creation failed')

  let verificationDelivered = false
  try {
    const codeResult = await issueCode({
      email: normalizedEmail,
      fullName: String(fullName).trim(),
      userId: authUserId,
    })
    verificationDelivered = Boolean(codeResult.delivered)
  } catch (error) {
    console.warn('create-user verification email failed:', error?.message || error)
  }

  await writeAuditLog({
    actorId: callerId,
    action: 'user_created',
    orgId: callerProfile.org_id,
    targetUserId: authUserId,
    metadata: { role },
  })

  return json(response, 201, { id: authUserId, tempPassword, verificationDelivered })
}
