// Shared JSON error helpers. Internal details are logged server-side only.
export function jsonError(response, status, { error, code = null, ...extra } = {}) {
  response.setHeader('Content-Type', 'application/json')
  const body = { error: error || 'Request could not be completed' }
  if (code) body.code = code
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) body[key] = value
  }
  return response.status(status).send(body)
}

export function logApiError(label, error) {
  console.error(`[api:${label}]`, error)
  return null
}

export function fail(
  response,
  status,
  fallbackMessage,
  error,
  { code = null, label = 'api', ...extra } = {},
) {
  logApiError(label, error)
  return jsonError(response, status, { error: fallbackMessage, code, ...extra })
}
