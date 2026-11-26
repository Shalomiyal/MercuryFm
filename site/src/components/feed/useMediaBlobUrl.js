// useMediaBlobUrl.js — resolves a feed media URL from:
//   1. Supabase Storage signed URL (storage_path / thumb_path) with auto-refresh
//   2. Legacy /api/media/:id authenticated blob URL (when storage_path is null)
//   3. Direct URL (for demo/mock posts)

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getSignedUrlsBatch, invalidateSignedUrl } from './signedUrlCache'

const blobUrlCache = new Map()
const inFlightRequests = new Map()

async function fetchLegacyMediaObjectUrl(mediaId) {
  if (blobUrlCache.has(mediaId)) return blobUrlCache.get(mediaId)
  if (inFlightRequests.has(mediaId)) return inFlightRequests.get(mediaId)

  const request = (async () => {
    const { data } = await supabase.auth.getSession()
    const accessToken = data.session?.access_token
    if (!accessToken) {
      throw new Error('Your session expired. Sign in again.')
    }
    const response = await fetch(`/api/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      throw new Error('Could not load media from database.')
    }
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    blobUrlCache.set(mediaId, objectUrl)
    return objectUrl
  })()

  inFlightRequests.set(mediaId, request)
  try {
    return await request
  } finally {
    inFlightRequests.delete(mediaId)
  }
}

export function useMediaBlobUrl(post, { enabled = true, preferThumb = false } = {}) {
  const directUrl = preferThumb
    ? post?.thumbnail_url || post?.file_url || ''
    : post?.file_url || post?.thumbnail_url || ''
  const storagePath = preferThumb
    ? post?.thumb_path || post?.storage_path || ''
    : post?.storage_path || post?.thumb_path || ''
  const mediaId = post?.media_id || ''

  const [url, setUrl] = useState(() => {
    if (directUrl) return directUrl
    if (!storagePath && mediaId && blobUrlCache.has(mediaId)) return blobUrlCache.get(mediaId)
    return ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retryCount, setRetryCount] = useState(0)

  const retry = useCallback(() => {
    if (storagePath) invalidateSignedUrl(storagePath)
    if (mediaId) blobUrlCache.delete(mediaId)
    setError('')
    setRetryCount((c) => c + 1)
  }, [storagePath, mediaId])

  useEffect(() => {
    if (!enabled) return
    if (directUrl) {
      setUrl(directUrl)
      setError('')
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')

    if (storagePath) {
      getSignedUrlsBatch([storagePath])
        .then((map) => {
          if (!cancelled) {
            const signed = map[storagePath] || ''
            if (!signed) throw new Error('Could not sign media URL.')
            setUrl(signed)
            setLoading(false)
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err?.message || 'Could not load media.')
            setLoading(false)
          }
        })
    } else if (mediaId) {
      fetchLegacyMediaObjectUrl(mediaId)
        .then((objectUrl) => {
          if (!cancelled) {
            setUrl(objectUrl)
            setLoading(false)
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err?.message || 'Could not load media.')
            setLoading(false)
          }
        })
    } else {
      setUrl('')
      setLoading(false)
    }

    return () => {
      cancelled = true
    }
  }, [directUrl, storagePath, mediaId, enabled, retryCount])

  return { url, loading, error, retry }
}
