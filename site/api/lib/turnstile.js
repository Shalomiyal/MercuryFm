import { clientIp } from './rateLimit.js'

export function turnstileConfigured() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

// Optional protection: when no secret key is configured the check is skipped
// entirely, preserving local development and existing deployments.
export async function verifyTurnstile(token, request) {
  if (!turnstileConfigured()) return { ok: true }
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'Security check is required. Please try again.' }
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: clientIp(request),
      }).toString(),
    })
    const result = await response.json()
    if (!result?.success) {
      return { ok: false, error: 'Security check failed. Please try again.' }
    }
    return { ok: true }
  } catch (error) {
    console.error('turnstile verification failed', error)
    return { ok: false, error: 'Security check is unavailable. Please try again.' }
  }
}
