import {
  createAdminClient,
  createContextClient,
  verifyCredentials,
} from '@supabase/server/core'

let cachedAdmin = null

// Service-role client. Reads SUPABASE_URL + SUPABASE_SECRET_KEY from the
// server environment; never import this from browser code.
export function adminClient() {
  if (!cachedAdmin) cachedAdmin = createAdminClient()
  return cachedAdmin
}

export function getAdminClient() {
  try {
    return { client: adminClient(), error: null }
  } catch (error) {
    return { client: null, error }
  }
}

// RLS-scoped client for the verified caller. Used where a policy check matters.
export function contextClient(auth) {
  return createContextClient({
    auth: { token: auth.token, keyName: auth.keyName },
  })
}

function bearerToken(request) {
  const header = request.headers?.authorization || ''
  return String(header).replace(/^Bearer\s+/i, '').trim()
}

// Verifies the user JWT locally against SUPABASE_JWKS_URL, then checks the
// server-owned account state. Clients cannot bypass these flags by hiding or
// editing their cached profile. Only the verification and password-change
// flows may opt out of the relevant gate.
export async function verifyUser(
  request,
  { allowUnverified = false, allowPasswordChange = false } = {},
) {
  const token = bearerToken(request)
  if (!token) {
    return {
      auth: null,
      userId: null,
      profile: null,
      error: { status: 401, message: 'Authentication required' },
    }
  }

  const { data: auth, error } = await verifyCredentials(
    { token, apikey: null },
    { auth: 'user' },
  )
  if (error || !auth?.userClaims?.id) {
    return {
      auth: null,
      userId: null,
      profile: null,
      error: {
        status: error?.status || 401,
        message: 'Invalid session',
        detail: error?.message || null,
      },
    }
  }

  const userId = auth.userClaims.id
  const { client, error: configError } = getAdminClient()
  if (configError) {
    return {
      auth,
      userId,
      profile: null,
      error: { status: 500, message: 'Server authentication is not configured' },
    }
  }

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('email_verified, must_change_password')
    .eq('id', userId)
    .maybeSingle()
  if (profileError) {
    return {
      auth,
      userId,
      profile: null,
      error: { status: 500, message: 'Account state could not be verified' },
    }
  }
  if (!profile) {
    return {
      auth,
      userId,
      profile: null,
      error: { status: 403, message: 'Account profile not found' },
    }
  }
  if (!allowUnverified && profile.email_verified === false) {
    return {
      auth,
      userId,
      profile,
      error: { status: 403, message: 'Email verification required', code: 'verification_required' },
    }
  }
  if (!allowPasswordChange && profile.must_change_password === true) {
    return {
      auth,
      userId,
      profile,
      error: {
        status: 403,
        message: 'Password change required',
        code: 'password_change_required',
      },
    }
  }

  return { auth, userId, profile, error: null }
}
