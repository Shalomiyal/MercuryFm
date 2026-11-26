// signedUrlCache.js — in-memory cache for Supabase Storage signed URLs
// Uses createSignedUrls in batches and refreshes automatically before expiry.

import { supabase } from '../../lib/supabase'

const DEFAULT_EXPIRY_SECONDS = 3600
const REFRESH_BUFFER_MS = 60_000
const BUCKET = 'work-media'

const cache = new Map() // path -> { url, expiresAt }

export function getCachedSignedUrl(path, now = Date.now()) {
  if (!path) return null
  const entry = cache.get(path)
  if (!entry) return null
  if (now >= entry.expiresAt) {
    cache.delete(path)
    return null
  }
  return entry.url
}

export function setCachedSignedUrl(path, url, expiresInSeconds = DEFAULT_EXPIRY_SECONDS, now = Date.now()) {
  if (!path || !url) return
  const ttlMs = Math.max(5_000, expiresInSeconds * 1000 - REFRESH_BUFFER_MS)
  cache.set(path, { url, expiresAt: now + ttlMs })
}

export function invalidateSignedUrl(path) {
  if (path) cache.delete(path)
}

export function clearSignedUrlCache() {
  cache.clear()
}

export async function getSignedUrlsBatch(paths, expiresInSeconds = DEFAULT_EXPIRY_SECONDS) {
  const unique = [...new Set((paths || []).filter(Boolean))]
  const result = {}
  const missing = []
  const now = Date.now()

  for (const path of unique) {
    const cached = getCachedSignedUrl(path, now)
    if (cached) result[path] = cached
    else missing.push(path)
  }

  if (missing.length === 0) return result

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(missing, expiresInSeconds)

  if (error) {
    throw error
  }

  for (const item of data || []) {
    if (item?.path && item?.signedUrl) {
      setCachedSignedUrl(item.path, item.signedUrl, expiresInSeconds, now)
      result[item.path] = item.signedUrl
    }
  }

  return result
}
