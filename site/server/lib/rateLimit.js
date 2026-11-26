import { adminClient } from './serverSupabase.js'
import { redisCommand } from './redis.js'

const memoryBuckets = (globalThis.__mercuryRateLimitBuckets ||= new Map())

export const RATE_LIMITS = {
  general: { limit: 100, windowMs: 60 * 1000 },
  strict: { limit: 5, windowMs: 15 * 60 * 1000 },
}

// Vercel/Nginx appends the trusted client address to x-forwarded-for. Never trust
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

async function redisConsume(key, limit, windowMs) {
  if (!process.env.REDIS_URL) return null
  const redisKey = `rl:${key}`
  const hits = Number(await redisCommand('INCR', redisKey))
  if (hits === 1) {
    await redisCommand('PEXPIRE', redisKey, windowMs)
  }
  if (hits > limit) {
    const ttlMs = Number(await redisCommand('PTTL', redisKey))
    const retryAfter = ttlMs > 0 ? Math.ceil(ttlMs / 1000) : Math.ceil(windowMs / 1000)
    return { limited: true, retryAfter: Math.max(1, retryAfter) }
  }
  return { limited: false, retryAfter: 0 }
}

// Uses Redis if REDIS_URL is set, otherwise shared Postgres counter,
// falling back to a per-instance counter in local dev / pre-migration envs.
export async function consumeRateLimit(key, limit, windowMs) {
  try {
    const redisResult = await redisConsume(key, limit, windowMs)
    if (redisResult) return redisResult
  } catch (error) {
    console.warn('[rate-limit] redis unavailable; falling back:', error?.message || error)
  }

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

export function sendRateLimited(response, retryAfter, body) {
  const seconds = Math.max(1, Number(retryAfter) || 1)
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Retry-After', String(seconds))
  return response.status(429).send({ ...body, retryAfter: seconds })
}
