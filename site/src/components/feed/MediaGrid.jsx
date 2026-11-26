// MediaGrid.jsx — 1-to-4 tile thumbnail grid for a feed bubble
// Uses thumb_path signed URLs (or legacy /api/media/:id) and loads full file only in lightbox.

import { useState } from 'react'
import { useMediaBlobUrl } from './useMediaBlobUrl'
import { formatDuration } from './feedUtils'

function MediaTile({ post, extraCount, onClick, index, isSingle }) {
  const isVideo = post.kind === 'video'
  const { url: mediaUrl, loading, error: fetchError, retry } = useMediaBlobUrl(post, {
    enabled: true,
    preferThumb: !(isSingle && !isVideo),
  })
  const [imgError, setImgError] = useState(false)
  const hasError = Boolean(fetchError) || imgError
  const durationLabel = isVideo ? formatDuration(post.duration_seconds) : ''

  function handleRetry(event) {
    event.stopPropagation()
    setImgError(false)
    retry()
  }

  return (
    <button
      type="button"
      className={`feed-media-tile ${extraCount > 0 ? 'has-overflow' : ''}`}
      onClick={onClick}
      aria-label={`${isVideo ? 'Play finish video' : 'View start photo'} for ${post.task_name || 'task'} ${index + 1}`}
    >
      {hasError ? (
        <div className="feed-media-error">
          <span>⚠</span>
          <span
            role="button"
            tabIndex={0}
            className="feed-media-retry"
            onClick={handleRetry}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRetry(e)
            }}
          >
            Retry
          </span>
        </div>
      ) : loading && !mediaUrl ? (
        <div className="feed-media-placeholder shimmer" />
      ) : mediaUrl && isVideo && !post.thumb_path && !post.isMock ? (
        <video
          src={mediaUrl}
          preload="metadata"
          muted
          playsInline
          className="feed-media-thumb"
          onError={() => setImgError(true)}
        />
      ) : mediaUrl ? (
        <img
          src={mediaUrl}
          alt={`${post.cleaner_name || 'Cleaner'} – ${post.task_name || 'Task'} ${post.stage || ''}`.trim()}
          loading="lazy"
          className="feed-media-thumb"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="feed-media-placeholder">
          {isVideo ? '🎬' : '📷'}
        </div>
      )}

      {isVideo && !hasError && (
        <div className="feed-play-overlay" aria-hidden="true">
          <div className="feed-play-icon">▶</div>
          {durationLabel && <span className="feed-video-duration">{durationLabel}</span>}
        </div>
      )}

      {extraCount > 0 && (
        <div className="feed-overflow-count" aria-hidden="true">
          +{extraCount}
        </div>
      )}
    </button>
  )
}

export default function MediaGrid({ posts, onOpen }) {
  if (!posts || posts.length === 0) return null

  const MAX_SHOWN = 4
  const shown = posts.slice(0, MAX_SHOWN)
  const hidden = Math.max(0, posts.length - MAX_SHOWN)

  return (
    <div className={`feed-media-grid tiles-${Math.min(shown.length, 4)}`}>
      {shown.map((post, index) => (
        <MediaTile
          key={post.post_id}
          post={post}
          isSingle={shown.length === 1}
          extraCount={index === MAX_SHOWN - 1 ? hidden : 0}
          index={index}
          onClick={() => onOpen(posts, index)}
        />
      ))}
    </div>
  )
}
