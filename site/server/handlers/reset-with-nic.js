import { adminClient } from '../lib/serverSupabase.js'
import { isValidEmail, normalizeEmail } from '../lib/emailVerification.js'

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

// Reset password back to NIC for org staff (admin/cleaner).
// Caller must supply: organizationId (slug), email, nic.
// If email + NIC match the member record, password is reset to NIC.
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return json(response, 405, { error: 'Method not allowed' })
  }

  const { organizationId, email, nic } = request.body || {}
  const slug = String(organizationId || '').trim().toLowerCase()
  const normalizedEmail = normalizeEmail(email)
  const normalizedNic = String(nic || '').trim().toUpperCase()

  if (!/^[a-z0-9_]{2,30}$/.test(slug)) {
    return json(response, 400, { error: 'Invalid organization ID' })
  }
  if (!isValidEmail(normalizedEmail)) {
    return json(response, 400, { error: 'Enter a valid email address' })
  }
  if (!/^(?:\d{9}[VX]|\d{12})$/.test(normalizedNic)) {
    return json(response, 400, { error: 'Enter a valid NIC number' })
  }

  const supabase = adminClient()

  // Find the organization
  const { data: org } = await supabase
    .from('organizations')
    .select('id, schema_name, is_active')
    .eq('slug', slug)
    .maybeSingle()
  if (!org?.is_active) {
    return json(response, 404, { error: 'Organization not found or inactive' })
  }

  // Find the auth user by email
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
  if (listError) {
    return json(response, 500, { error: 'Could not verify identity' })
  }
  const authUser = users?.find((u) => u.email?.toLowerCase() === normalizedEmail.toLowerCase())
  if (!authUser) {
    // Generic message to avoid user enumeration
    return json(response, 200, { success: true })
  }

  // Verify the NIC matches the member record in the tenant schema
  let nicMatches = false
  try {
    const { data: member } = await supabase
      .schema(org.schema_name)
      .from('members')
      .select('nic')
      .eq('id', authUser.id)
      .maybeSingle()
    if (member?.nic && member.nic.toUpperCase() === normalizedNic) {
      nicMatches = true
    }
  } catch {
    // Schema access error — deny
  }

  if (!nicMatches) {
    // Generic message to avoid enumeration
    return json(response, 200, { success: true })
  }

  // Reset password to NIC
  const { error: updateError } = await supabase.auth.admin.updateUserById(authUser.id, {
    password: normalizedNic,
  })
  if (updateError) {
    console.error('reset-with-nic update failed', updateError.message)
    return json(response, 500, { error: 'Could not reset password. Please contact your administrator.' })
  }

  return json(response, 200, { success: true })
}
