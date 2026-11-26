import { redisCommand } from './redis.js'

const memoryCache = (globalThis.__mercuryCache ||= new Map())

export async function cacheGet(key) {
  try {
    if (process.env.REDIS_URL) {
      const raw = await redisCommand('GET', `cache:${key}`)
      if (raw !== null && raw !== undefined) return JSON.parse(raw)
    }
  } catch (error) {
    console.warn('[cache] redis get failed:', error?.message || error)
  }

  const entry = memoryCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key)
    return null
  }
  return entry.value
}

export async function cacheSet(key, value, ttlSeconds = 60) {
  const ttl = Math.max(1, Number(ttlSeconds) || 60)
  memoryCache.set(key, { value, expiresAt: Date.now() + ttl * 1000 })
  try {
    if (process.env.REDIS_URL) {
      await redisCommand('SET', `cache:${key}`, JSON.stringify(value), 'EX', ttl)
    }
  } catch (error) {
    console.warn('[cache] redis set failed:', error?.message || error)
  }
}

export async function cacheDelete(key) {
  memoryCache.delete(key)
  try {
    if (process.env.REDIS_URL) {
      await redisCommand('DEL', `cache:${key}`)
    }
  } catch (error) {
    console.warn('[cache] redis del failed:', error?.message || error)
  }
}
