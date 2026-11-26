import { adminClient } from '../lib/serverSupabase.js'
import {
  isValidEmail,
  normalizeEmail,
  rateLimit,
  clientIp,
} from '../lib/emailVerification.js'
import { writeAuditLog } from '../lib/audit.js'
import { verifyTurnstile } from '../lib/turnstile.js'
import { sendRateLimited } from '../lib/rateLimit.js'

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return json(response, 405, { error: 'Method not allowed' })
  }

  const { organizationId, fullName, nic, phone, email } = request.body || {}
  const slug = String(organizationId || '').trim().toLowerCase()
  const normalizedEmail = normalizeEmail(email)
  const normalizedNic = String(nic || '').trim().toUpperCase()

  if (!/^[a-z0-9_]{2,30}$/.test(slug)) {
    return json(response, 400, { error: 'Invalid organization ID' })
  }
  if (!String(fullName || '').trim()) {
    return json(response, 400, { error: 'Full name is required' })
  }
  if (!/^(?:\d{9}[VX]|\d{12})$/.test(normalizedNic)) {
    return json(response, 400, {
      error: 'Enter a valid NIC: 9 digits followed by V/X or 12 digits',
    })
  }
  if (!isValidEmail(normalizedEmail)) {
    return json(response, 400, { error: 'Enter a valid email address' })
  }

  const challenge = await verifyTurnstile(request.body?.turnstileToken, request)
  if (!challenge.ok) {
    return json(response, 403, { error: challenge.error })
  }

  const ipLimit = await rateLimit(`signup-ip:${clientIp(request)}`, 10, 60 * 60 * 1000)
  if (ipLimit.limited) {
    return sendRateLimited(response, ipLimit.retryAfter, {
      code: 'rate_limited',
      error: 'Too many signup attempts. Please try again later.',
    })
  }

  const supabase = adminClient()
  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('id, is_active')
    .eq('slug', slug)
    .maybeSingle()
  if (organizationError) {
    console.error('start-signup organization lookup failed', organizationError)
    return json(response, 400, { error: 'Could not check the organization code' })
  }
  if (!organization?.is_active) {
    return json(response, 404, { error: 'Organization code not found or inactive' })
  }

  // NIC is used as the initial password — staff can change it after first login
  const memberRole = 'cleaner'

  let authUserId = null
  try {
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: normalizedNic,   // ← NIC as initial password
        email_confirm: true,
        user_metadata: { full_name: String(fullName).trim() },
      })
    if (authError) {
      return json(response, 409, {
        error: authError.code === 'email_exists' ||
            /already (been )?registered|already exists/i.test(authError.message)
          ? 'An account with this email already exists. Please sign in instead.'
          : 'Could not create the account. Please try again.',
      })
    }
    authUserId = authData.user.id

    const { error: profileError } = await supabase.from('profiles').insert({
      id: authUserId,
      role: memberRole,
      org_id: organization.id,
      email_verified: true,
      full_name: null,
      nic: null,
      must_change_password: null,
    })
    if (profileError) throw profileError

    const { error: memberError } = await supabase.rpc('insert_tenant_user', {
      p_org_id: organization.id,
      p_id: authUserId,
      p_full_name: String(fullName).trim(),
      p_nic: normalizedNic,
      p_phone: String(phone || '').trim() || null,
      p_role: memberRole,
      p_must_change_password: false,
    })
    if (memberError) throw memberError

    await writeAuditLog({
      action: 'signup_completed',
      orgId: organization.id,
      targetUserId: authUserId,
      metadata: { role: memberRole },
    })

    return json(response, 201, {
      success: true,
      email: normalizedEmail,
    })
  } catch (error) {
    console.error('start-signup failed', error)
    if (authUserId) {
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {})
    }
    return json(response, 500, {
      error: 'Could not create the account. Please try again.',
    })
  }
}
