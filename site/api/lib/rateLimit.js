import { adminClient } from './serverSupabase.js'

const memoryBuckets = (globalThis.__mercuryRateLimitBuckets ||= new Map())

// Vercel appends the trusted client address to x-forwarded-for. Never trust
// the leftmost entry, which a client can spoof.
export function clientIp(request) {
  const forwarded = String(request.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return (
    forwarded.at(-1) ||
    String(request.headers?.['x-vercel-forwarded-for'] || '').split(',')[0].trim() ||
    String(request.headers?.['x-real-ip'] || '') ||
    'local'
  )
}

function memoryConsume(key, limit, windowMs) {
  const now = Date.now()
  const bucket = memoryBuckets.get(key)
  if (!bucket || now - bucket.windowStart >= windowMs) {
    memoryBuckets.set(key, { windowStart: now, hits: 1 })
    return { limited: false, retryAfter: 0 }
  }
  bucket.hits += 1
  if (bucket.hits > limit) {
    return {
      limited: true,
      retryAfter: Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000)),
    }
  }
  return { limited: false, retryAfter: 0 }
}

// Uses the shared Postgres counter once the rate-limit migration has run.
// Falls back to a per-instance counter when the RPC is not deployed yet so
// local development and pre-migration environments keep working.
export async function consumeRateLimit(key, limit, windowMs) {
  try {
    const { data, error } = await adminClient().rpc('consume_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    if (row && typeof row.allowed === 'boolean') {
      return {
        limited: !row.allowed,
        retryAfter: Math.max(0, Number(row.retry_after_seconds) || 0),
      }
    }
  } catch (error) {
    console.warn('[rate-limit] shared counter unavailable; using local fallback:', error?.message || error)
  }
  return memoryConsume(key, limit, windowMs)
}
