const PENDING_KEY = 'mercury-auth-flow'
const MAX_AGE_MS = 60 * 60 * 1000

export function setPendingAuthFlow(flow) {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ ...flow, createdAt: Date.now() }),
    )
  } catch {
    /* storage unavailable */
  }
}

export function getPendingAuthFlow() {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const flow = JSON.parse(raw)
    if (!flow || !flow.createdAt) return null
    if (Date.now() - flow.createdAt > MAX_AGE_MS) {
      localStorage.removeItem(PENDING_KEY)
      return null
    }
    return flow
  } catch {
    return null
  }
}

export function clearPendingAuthFlow() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    /* storage unavailable */
  }
}

const SENT_PREFIX = 'mercury-auth-link-sent:'
const OTP_COOLDOWN_MS = 60 * 1000 // 60 s — matches Supabase's default rate-limit window

export function hasAuthLinkBeenSent(key) {
  try {
    const raw = localStorage.getItem(SENT_PREFIX + key)
    if (!raw) return false
    const { ts } = JSON.parse(raw)
    // Treat the link as "already sent" for the cooldown window so we don't
    // fire another OTP request on every re-mount while Supabase is throttling.
    return Date.now() - ts < OTP_COOLDOWN_MS
  } catch {
    return false
  }
}

export function markAuthLinkSent(key) {
  try {
    localStorage.setItem(SENT_PREFIX + key, JSON.stringify({ ts: Date.now() }))
  } catch {
    /* storage unavailable */
  }
}

export function clearAuthLinkSent(key) {
  try {
    localStorage.removeItem(SENT_PREFIX + key)
  } catch {
    /* storage unavailable */
  }
}

export function authCallbackUrl() {
  return `${window.location.origin}/auth/callback`
}

export function homeForRole(role) {
  if (role === 'platform_admin') return '/platform'
  if (role === 'cleaner') return '/cleaner/tasks'
  return '/admin'
}