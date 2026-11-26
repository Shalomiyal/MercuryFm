import {
  clientIp,
  isValidEmail,
  normalizeEmail,
  rateLimit,
  verifyCode,
} from '../lib/emailVerification.js'
import { sendRateLimited } from '../lib/rateLimit.js'

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return json(response, 405, { error: 'Method not allowed' })
  }

  const { email, code } = request.body || {}
  const normalizedEmail = normalizeEmail(email)
  if (!isValidEmail(normalizedEmail)) {
    return json(response, 400, { code: 'invalid_email', error: 'Enter a valid email address' })
  }
  if (!/^\d{6}$/.test(String(code || ''))) {
    return json(response, 400, { code: 'invalid_format', error: 'Enter the 6-digit code.' })
  }
  const ipLimit = await rateLimit(`verify-ip:${clientIp(request)}`, 30, 15 * 60 * 1000)
  if (ipLimit.limited) {
    return sendRateLimited(response, ipLimit.retryAfter, {
      code: 'rate_limited',
      error: 'Too many verification attempts. Please try again later.',
    })
  }

  try {
    const result = await verifyCode({ email: normalizedEmail, code: String(code) })
    return json(response, result.status, {
      verified: result.status === 200,
      code: result.code,
      error: result.error,
    })
  } catch (error) {
    console.error('verify-code failed', error)
    return json(response, 500, { error: 'Could not verify the code. Please try again.' })
  }
}
