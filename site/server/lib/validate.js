/**
 * Lightweight zero-dependency input validation helpers for serverless API handlers.
 */
export function validateBody(body, schema) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object', data: null }
  }

  const data = {}
  for (const [field, rule] of Object.entries(schema)) {
    const raw = body[field]
    if (raw === undefined || raw === null || raw === '') {
      if (rule.required) {
        return { ok: false, error: `${field} is required`, data: null }
      }
      if ('default' in rule) data[field] = rule.default
      continue
    }

    if (rule.type === 'string') {
      if (typeof raw !== 'string') {
        return { ok: false, error: `${field} must be a string`, data: null }
      }
      const trimmed = rule.trim === false ? raw : raw.trim()
      if (rule.min && trimmed.length < rule.min) {
        return { ok: false, error: `${field} must be at least ${rule.min} characters`, data: null }
      }
      if (rule.max && trimmed.length > rule.max) {
        return { ok: false, error: `${field} must be at most ${rule.max} characters`, data: null }
      }
      if (rule.pattern && !rule.pattern.test(trimmed)) {
        return { ok: false, error: rule.message || `${field} format is invalid`, data: null }
      }
      if (rule.enum && !rule.enum.includes(trimmed)) {
        return { ok: false, error: `${field} must be one of: ${rule.enum.join(', ')}`, data: null }
      }
      data[field] = rule.lowercase ? trimmed.toLowerCase() : trimmed
    } else if (rule.type === 'number') {
      const num = Number(raw)
      if (!Number.isFinite(num)) {
        return { ok: false, error: `${field} must be a number`, data: null }
      }
      if (rule.min !== undefined && num < rule.min) {
        return { ok: false, error: `${field} must be >= ${rule.min}`, data: null }
      }
      if (rule.max !== undefined && num > rule.max) {
        return { ok: false, error: `${field} must be <= ${rule.max}`, data: null }
      }
      data[field] = num
    } else if (rule.type === 'boolean') {
      if (typeof raw !== 'boolean') {
        return { ok: false, error: `${field} must be a boolean`, data: null }
      }
      data[field] = raw
    } else {
      data[field] = raw
    }
  }

  return { ok: true, error: null, data }
}
