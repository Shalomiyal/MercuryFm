import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { db } from '../../lib/db'
import { WORK_MEDIA_BUCKET } from '../../lib/media'

export default function CleanerMediaPreview({
  mediaId,
  storagePath,
  thumbPath,
  kind = 'photo',
  label = '',
}) {
  const [url, setUrl] = useState('')
  const [posterUrl, setPosterUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let revokedBlob = ''

    async function resolveMedia() {
      setLoading(true)
      setError('')
      try {
        let resolvedPath = storagePath || null
        let resolvedThumb = thumbPath || null

        if (!resolvedPath && mediaId) {
          const orgDb = await db()
          const { data: row } = await orgDb
            .from('media')
            .select('storage_path, thumb_path')
            .eq('id', mediaId)
            .maybeSingle()
          resolvedPath = row?.storage_path || null
          resolvedThumb = row?.thumb_path || resolvedThumb
        }

        if (resolvedPath) {
          const [mainRes, thumbRes] = await Promise.all([
            supabase.storage.from(WORK_MEDIA_BUCKET).createSignedUrl(resolvedPath, 3600),
            resolvedThumb
              ? supabase.storage.from(WORK_MEDIA_BUCKET).createSignedUrl(resolvedThumb, 3600)
              : Promise.resolve({ data: null }),
          ])
          if (!active) return
          if (mainRes.error || !mainRes.data?.signedUrl) {
            setError('Could not load preview.')
          } else {
            setUrl(mainRes.data.signedUrl)
            if (thumbRes?.data?.signedUrl) setPosterUrl(thumbRes.data.signedUrl)
          }
          setLoading(false)
          return
        }

        const { data } = await supabase.auth.getSession()
        const accessToken = data.session?.access_token
        if (!accessToken || !mediaId) {
          if (active) setError('Preview unavailable.')
          return
        }
        const response = await fetch(`/api/media/${mediaId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (!response.ok) {
          if (active) setError('Preview unavailable.')
          return
        }
        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        revokedBlob = objectUrl
        if (active) setUrl(objectUrl)
      } catch {
        if (active) setError('Preview unavailable.')
      } finally {
        if (active) setLoading(false)
      }
    }

    resolveMedia()
    return () => {
      active = false
      if (revokedBlob) URL.revokeObjectURL(revokedBlob)
    }
  }, [mediaId, storagePath, thumbPath])

  return (
    <div className="cleaner-media-card">
      {label ? <span className="cleaner-media-label">{label}</span> : null}
      {loading ? (
        <div className="cleaner-media-skeleton skeleton" />
      ) : error ? (
        <p className="cleaner-media-error">{error}</p>
      ) : kind === 'video' ? (
        <video
          src={url}
          poster={posterUrl || undefined}
          controls
          playsInline
          preload="metadata"
          className="cleaner-media-video"
        />
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="cleaner-media-link">
          <img src={url} alt={label || 'Uploaded photo'} loading="lazy" className="cleaner-media-img" />
        </a>
      )}
    </div>
  )
}
