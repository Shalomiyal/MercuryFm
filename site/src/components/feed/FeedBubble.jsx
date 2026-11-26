// FeedBubble.jsx — WhatsApp-style cleaner message bubble (memoized)
import { memo, useMemo, useState } from 'react'
import MediaGrid from './MediaGrid'
import MediaLightbox from './MediaLightbox'

const CLEANER_COLORS = [
  '#16a34a', '#7c3aed', '#0369a1', '#b45309', '#be123c',
  '#0891b2', '#d97706', '#6d28d9', '#065f46', '#9f1239',
]

const colorCache = new Map()
function cleanerColor(id) {
  if (!colorCache.has(id)) {
    let hash = 0
    for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) & 0xffff
    colorCache.set(id, CLEANER_COLORS[hash % CLEANER_COLORS.length])
  }
  return colorCache.get(id)
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
}

const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
const DATETIME_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

function FeedBubble({ post, posts: groupedPosts, isUnread = false, onMarkRead }) {
  const mediaPosts = groupedPosts && groupedPosts.length > 0 ? groupedPosts : [post]
  const lead = mediaPosts[0]
  const latest = mediaPosts[mediaPosts.length - 1]

  const [lightboxPosts, setLightboxPosts] = useState(null)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const color = useMemo(() => cleanerColor(lead.cleaner_id), [lead.cleaner_id])
  const timeLabel = useMemo(() => {
    if (!latest.created_at) return ''
    return TIME_FMT.format(new Date(latest.created_at))
  }, [latest.created_at])

  const datetimeLabel = useMemo(() => {
    if (!latest.created_at) return ''
    return DATETIME_FMT.format(new Date(latest.created_at))
  }, [latest.created_at])

  function openLightbox(items, index) {
    setLightboxPosts(items)
    setLightboxIndex(index)
    onMarkRead?.(mediaPosts.map((p) => p.post_id))
  }

  return (
    <>
      <article
        className={`feed-bubble ${isUnread ? 'is-unread' : ''}`}
        data-kind={lead.kind}
        onClick={() => {
          if (isUnread) onMarkRead?.(mediaPosts.map((p) => p.post_id))
        }}
      >
        {/* Avatar */}
        <div
          className="feed-avatar"
          style={{ background: color }}
          aria-hidden="true"
          title={lead.cleaner_name}
        >
          {initials(lead.cleaner_name)}
        </div>

        {/* Bubble body */}
        <div className="feed-bubble-body">
          <span className="feed-sender" style={{ color }}>{lead.cleaner_name}</span>

          {(lead.room_id || lead.task_name || lead.branch_id) && (
            <div className="feed-meta-line">
              {[
                lead.room_id ? `Room ${lead.room_id}` : '',
                lead.task_name || '',
                lead.branch_id || '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          )}

          <MediaGrid posts={mediaPosts} onOpen={openLightbox} />

          {lead.caption && (
            <p className="feed-caption">{lead.caption}</p>
          )}

          {lead.isMock && (
            <span className="feed-mock-badge" title="Sample data — no real uploads yet">demo</span>
          )}

          <time
            className="feed-timestamp"
            dateTime={latest.created_at}
            title={datetimeLabel}
          >
            {isUnread ? <span className="feed-unread-dot" title="Unread" /> : null}
            {timeLabel}
          </time>
        </div>
      </article>

      {lightboxPosts && (
        <MediaLightbox
          posts={lightboxPosts}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxPosts(null)}
        />
      )}
    </>
  )
}

export default memo(FeedBubble)
