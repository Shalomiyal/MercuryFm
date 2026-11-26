// MediaLightbox.jsx — full-screen media preview with focus trap, keyboard nav, download, zoom
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMediaBlobUrl } from './useMediaBlobUrl'

const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function formatTs(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${DATE_FMT.format(d)} · ${TIME_FMT.format(d)}`
}

export default function MediaLightbox({ posts, initialIndex, onClose }) {
  const [index, setIndex] = useState(initialIndex ?? 0)
  const [imgError, setImgError] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const startX = useRef(null)
  const videoRef = useRef(null)
  const dialogRef = useRef(null)

  const current = posts[index]
  const isVideo = current?.kind === 'video'
  const { url: viewUrl, loading, error: fetchError, retry } = useMediaBlobUrl(current, {
    enabled: Boolean(current),
    preferThumb: false,
  })
  const hasError = Boolean(fetchError) || imgError

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(i + 1, posts.length - 1))
    setImgError(false)
    setZoomed(false)
  }, [posts.length])

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0))
    setImgError(false)
    setZoomed(false)
  }, [])

  useEffect(() => {
    const prevFocus = document.activeElement
    dialogRef.current?.focus()

    function onKey(event) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') goNext()
      if (event.key === 'ArrowLeft') goPrev()
      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus()
    }
  }, [onClose, goNext, goPrev])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  function onTouchStart(e) {
    startX.current = e.touches[0].clientX
  }
  function onTouchEnd(e) {
    if (startX.current === null) return
    const delta = e.changedTouches[0].clientX - startX.current
    if (Math.abs(delta) > 60) delta < 0 ? goNext() : goPrev()
    startX.current = null
  }

  if (!current) return null

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Header */}
      <div className="lightbox-header">
        <div className="lightbox-meta">
          <span className="lightbox-cleaner">{current.cleaner_name}</span>
          {(current.branch_id || current.room_id) && (
            <span className="lightbox-room">
              {[current.branch_id, current.room_id ? `Room ${current.room_id}` : '']
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
          {current.task_name && <span className="lightbox-room">{current.task_name}</span>}
          <span className="lightbox-ts">{formatTs(current.created_at)}</span>
        </div>
        <div className="lightbox-actions">
          {viewUrl && (
            <a
              href={viewUrl}
              download={`${current.cleaner_name || 'media'}-${current.stage || current.kind}.${isVideo ? 'mp4' : 'jpg'}`}
              target="_blank"
              rel="noopener noreferrer"
              className="lightbox-btn"
              aria-label="Download"
              title="Download"
            >
              ↓
            </a>
          )}
          <button type="button" className="lightbox-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {/* Media */}
      <div className={`lightbox-media ${zoomed ? 'zoomed' : ''}`}>
        {loading && !viewUrl ? (
          <div className="lightbox-error">
            <p>Loading media...</p>
          </div>
        ) : hasError ? (
          <div className="lightbox-error">
            <p>{fetchError || 'Could not load media.'}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setImgError(false)
                retry()
              }}
            >
              Retry
            </button>
          </div>
        ) : isVideo && viewUrl ? (
          <video
            ref={videoRef}
            src={viewUrl}
            controls
            autoPlay
            className="lightbox-video"
            onError={() => setImgError(true)}
          />
        ) : viewUrl ? (
          <img
            src={viewUrl}
            alt={`${current.cleaner_name} – ${current.task_name}`}
            className="lightbox-img"
            onClick={() => setZoomed((z) => !z)}
            onError={() => setImgError(true)}
            draggable={false}
          />
        ) : null}
      </div>

      {/* Nav arrows */}
      {posts.length > 1 && (
        <>
          <button
            type="button"
            className="lightbox-nav prev"
            onClick={goPrev}
            disabled={index === 0}
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            type="button"
            className="lightbox-nav next"
            onClick={goNext}
            disabled={index === posts.length - 1}
            aria-label="Next"
          >
            ›
          </button>
        </>
      )}

      {/* Dots indicator */}
      {posts.length > 1 && (
        <div className="lightbox-dots" aria-hidden="true">
          {posts.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`lightbox-dot ${i === index ? 'active' : ''}`}
              onClick={() => {
                setIndex(i)
                setImgError(false)
                setZoomed(false)
              }}
              aria-label={`Go to item ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
