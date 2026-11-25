import { getAdminClient, verifyUser } from './lib/serverSupabase.js'
import { createDbPool } from './lib/dbPool.js'
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

  const dbUrl = process.env.SUPABASE_DB_URL
  if (!dbUrl) {
    return json(response, 500, { error: 'SUPABASE_DB_URL is required for provisioning rollback' })
  }
  const { client: serverClient, error: configError } = getAdminClient()
  if (configError) {
    return json(response, 500, { error: 'Supabase server configuration is missing' })
  }

  const { userId, error: authError } = await verifyUser(request)
  if (authError) {
    return json(response, authError.status, { error: 'Invalid session' })
  }
  const { data: callerProfile, error: callerProfileError } = await serverClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (callerProfileError || !callerProfile) {
    return json(response, 403, { error: 'Could not verify platform admin profile' })
  }
  if (callerProfile.role !== 'platform_admin') {
    return json(response, 403, { error: 'Platform admin access required' })
  }

  const { name, slug, orgAdminFullName, email } = request.body || {}
  const normalizedEmail = normalizeEmail(email)
  if (!name?.trim() || !slug?.trim() || !orgAdminFullName?.trim() ||
      !isValidEmail(normalizedEmail)) {
    return json(response, 400, {
      error: 'Organization name, slug, admin name, and a valid email are required',
    })
  }

  const sanitizedSlug = String(slug).trim().toLowerCase()
  if (!/^[a-z0-9_]{2,30}$/.test(sanitizedSlug)) {
    return json(response, 400, {
      error: 'Slug must be 2-30 characters: lowercase letters, numbers, and underscores only',
    })
  }

  const { data: organizationId, error: provisionError } = await serverClient
    .rpc('provision_organization', {
      p_name: name.trim(),
      p_slug: sanitizedSlug,
    })
  if (provisionError) {
    console.error('create-organization provision failed', provisionError)
    return json(response, 400, { error: 'Organization could not be provisioned' })
  }

  const tempPassword = generateTemporaryPassword()
  let authUserId = null
  try {
    const { data: authData, error: createError } =
      await serverClient.auth.admin.createUser({
        email: normalizedEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: orgAdminFullName.trim() },
      })
    if (createError) throw createError
    authUserId = authData.user.id

    const { error: profileError } = await serverClient
      .from('profiles')
      .insert({
        id: authUserId,
        full_name: orgAdminFullName.trim(),
        role: 'org_admin',
        org_id: organizationId,
        email_verified: false,
        must_change_password: true,
      })
    if (profileError) throw profileError

    // org_admin details stay in public.profiles. Tenant members are only
    // admin/cleaner, so no row is inserted into org_<slug>.members here.
    await writeAuditLog({
      actorId: userId,
      action: 'organization_created',
      orgId: organizationId,
      targetUserId: authUserId,
      metadata: { slug: sanitizedSlug },
    })

    let verificationDelivered = false
    try {
      const codeResult = await issueCode({
        email: normalizedEmail,
        fullName: String(orgAdminFullName).trim(),
        userId: authUserId,
      })
      verificationDelivered = Boolean(codeResult.delivered)
    } catch (error) {
      console.warn('create-organization verification email failed:', error?.message || error)
    }

    return json(response, 201, {
      organizationId,
      schemaName: `org_${sanitizedSlug}`,
      orgAdminId: authUserId,
      tempPassword,
      verificationDelivered,
    })
  } catch (error) {
    console.error('create-organization failed', error)
    if (authUserId) {
      await serverClient.auth.admin.deleteUser(authUserId).catch(() => {})
    }

    const pool = createDbPool(dbUrl)
    try {
      await pool.query('begin')
      await pool.query(`drop schema if exists ${pgQuoteIdent(`org_${sanitizedSlug}`)} cascade`)
      await pool.query('delete from public.profiles where org_id = $1', [organizationId])
      await pool.query('delete from public.organizations where id = $1', [organizationId])
      await pool.query('commit')
      await pool.query('select public.refresh_exposed_schemas()')
    } catch (rollbackError) {
      await pool.query('rollback').catch(() => {})
      console.error('create-organization rollback failed', rollbackError)
    } finally {
      await pool.end()
    }
    return json(response, 400, { error: 'Organization provisioning failed' })
  }
}

function pgQuoteIdent(value) {
  return `"${value.replace(/"/g, '""')}"`
}
