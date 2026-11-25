import { adminClient } from './lib/serverSupabase.js'
import {
  issueCode,
  isValidEmail,
  normalizeEmail,
  rateLimit,
  clientIp,
} from './lib/emailVerification.js'
import { generateTemporaryPassword } from './lib/passwords.js'
import { hashInviteCode, normalizeInviteCode } from './lib/invites.js'
import { writeAuditLog } from './lib/audit.js'
import { verifyTurnstile } from './lib/turnstile.js'

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return json(response, 405, { error: 'Method not allowed' })
  }

  const { organizationId, fullName, nic, phone, email, inviteCode } = request.body || {}
  const slug = String(organizationId || '').trim().toLowerCase()
  const normalizedEmail = normalizeEmail(email)
  const normalizedNic = String(nic || '').trim().toUpperCase()
  const normalizedInvite = normalizeInviteCode(inviteCode)
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
  if (!/^[A-Z0-9]{6,20}$/.test(normalizedInvite)) {
    return json(response, 400, { error: 'Enter the invite code from your administrator' })
  }
  const challenge = await verifyTurnstile(request.body?.turnstileToken, request)
  if (!challenge.ok) {
    return json(response, 403, { error: challenge.error })
  }
  const ipLimit = await rateLimit(`signup-ip:${clientIp(request)}`, 10, 60 * 60 * 1000)
  if (ipLimit.limited) {
    return json(response, 429, {
      code: 'rate_limited',
      error: 'Too many signup attempts. Please try again later.',
      retryAfter: ipLimit.retryAfter,
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

  const { data: inviteRows, error: inviteError } = await supabase.rpc(
    'validate_organization_invite',
    {
      p_code_hash: hashInviteCode(normalizedInvite),
      p_email: normalizedEmail,
    },
  )
  const invite = Array.isArray(inviteRows) ? inviteRows[0] : inviteRows
  if (inviteError || !invite?.org_id || invite.org_id !== organization.id) {
    console.warn('start-signup invite rejected', inviteError?.message || 'no matching invite')
    return json(response, 403, {
      error: 'This invite code is invalid, expired, already used, or for another organization',
    })
  }
  const invitedRole = ['admin', 'cleaner'].includes(invite.role) ? invite.role : 'cleaner'
  const tempPassword = generateTemporaryPassword()

  let authUserId = null
  try {
    // email_confirm: true stops Supabase from sending its own verification
    // link. Our 6-digit code is the only verification step. The temporary
    // password is never derived from the NIC and is returned exactly once.
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: tempPassword,
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
      role: invitedRole,
      org_id: organization.id,
      email_verified: false,
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
      p_role: invitedRole,
      p_must_change_password: true,
    })
    if (memberError) throw memberError

    const { data: consumed, error: consumeError } = await supabase.rpc(
      'consume_organization_invite',
      { p_invite_id: invite.invite_id },
    )
    if (consumeError || consumed !== true) {
      throw consumeError || new Error('Invite could not be consumed')
    }

    await writeAuditLog({
      action: 'signup_started',
      orgId: organization.id,
      targetUserId: authUserId,
      metadata: { invite_id: invite.invite_id, role: invitedRole },
    })

    const codeResult = await issueCode({
      email: normalizedEmail,
      fullName: String(fullName).trim(),
      userId: authUserId,
    })
    const common = {
      email: normalizedEmail,
      tempPassword,
      delivered: codeResult.delivered,
      cooldown: Boolean(codeResult.cooldown),
    }
    if (codeResult.cooldown) {
      // The account was just created; keep the user able to continue from the
      // verification screen even if a resend window is already open.
      return json(response, 200, common)
    }
    return json(response, 201, common)
  } catch (error) {
    console.error('start-signup failed', error)
    if (authUserId) {
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {})
    }
    return json(response, 500, {
      error: 'Could not start signup. Please try again.',
    })
  }
}
