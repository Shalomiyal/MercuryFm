function parseAllowedOrigins() {
  const raw = [process.env.APP_ORIGIN, process.env.ALLOWED_ORIGINS]
    .filter(Boolean)
    .join(',')
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )
}

/**
 * Applies strict CORS headers when an origin allowlist is configured.
 * Never emits Access-Control-Allow-Origin: * in production.
 * Returns true if the request was a preflight OPTIONS request and handled.
 */
export function applyCors(request, response, methods = 'GET, POST, OPTIONS') {
  const origin = String(request.headers?.origin || '').trim().replace(/\/+$/, '')
  const allowed = parseAllowedOrigins()

  if (origin && allowed.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', methods)
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    response.setHeader('Access-Control-Allow-Credentials', 'true')
  }

  if (request.method === 'OPTIONS') {
    if (origin && !allowed.has(origin)) {
      response.status(403).send({ error: 'Origin not allowed' })
      return true
    }
    response.status(204).send('')
    return true
  }

  return false
}
