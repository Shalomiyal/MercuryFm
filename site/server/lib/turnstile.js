import { clientIp } from './rateLimit.js'
import { CircuitBreaker, withRetry, withTimeout } from './resilience.js'

const turnstileBreaker = new CircuitBreaker('turnstile', {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
})

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

  return turnstileBreaker.exec(
    () =>
      withRetry(
        () =>
          withTimeout(async (signal) => {
            const response = await fetch(
              'https://challenges.cloudflare.com/turnstile/v0/siteverify',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                signal,
                body: new URLSearchParams({
                  secret: process.env.TURNSTILE_SECRET_KEY,
                  response: token,
                  remoteip: clientIp(request),
                }).toString(),
              },
            )
            if (!response.ok) {
              throw new Error(`Turnstile HTTP ${response.status}`)
            }
            const result = await response.json()
            if (!result?.success) {
              return { ok: false, error: 'Security check failed. Please try again.' }
            }
            return { ok: true }
          }, 4000, 'turnstile'),
        { retries: 1, baseDelayMs: 150 },
      ),
    (error) => {
      console.error('turnstile verification failed', error)
      return { ok: false, error: 'Security check is unavailable. Please try again.' }
    },
  )
}
