import {
  clientIp,
  issueCode,
  isValidEmail,
  normalizeEmail,
  rateLimit,
  RESEND_COOLDOWN_MS,
} from '../lib/emailVerification.js'
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

  const { email, fullName, userId } = request.body || {}
  const normalizedEmail = normalizeEmail(email)
  if (!isValidEmail(normalizedEmail)) {
    return json(response, 400, { error: 'Enter a valid email address' })
  }
  const challenge = await verifyTurnstile(request.body?.turnstileToken, request)
  if (!challenge.ok) {
    return json(response, 403, { error: challenge.error })
  }
  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit(`ip:${clientIp(request)}`, 20, 15 * 60 * 1000),
    rateLimit(`email:${normalizedEmail}`, 5, 15 * 60 * 1000),
  ])
  if (ipLimit.limited || emailLimit.limited) {
    const retryAfter = Math.max(ipLimit.retryAfter, emailLimit.retryAfter)
    return sendRateLimited(response, retryAfter, {
      code: 'rate_limited',
      error: 'Too many code requests. Please try again later.',
    })
  }

  try {
    const result = await issueCode({
      email: normalizedEmail,
      fullName: String(fullName || '').trim(),
      userId,
    })
    if (result.cooldown) {
      return sendRateLimited(response, result.retryAfter, {
        code: 'cooldown',
        error: `Please wait ${result.retryAfter} seconds before requesting another code.`,
      })
    }
    return json(response, 200, {
      ok: true,
      delivered: result.delivered,
      expiresIn: result.expiresIn,
      resendAfter: RESEND_COOLDOWN_MS / 1000,
    })
  } catch (error) {
    console.error('send-code failed', error)
    return json(response, 500, {
      error: error?.message === 'Email delivery is not configured'
        ? 'Email delivery is not configured. Contact support.'
        : 'Could not send the code. Please try again.',
    })
  }
}
