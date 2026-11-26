// WorkFeed.jsx — admin Work Feed: WhatsApp-style scrolling media timeline
// Placed below the assignment section in DailyTasksPage.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useDataRefresh } from '../../contexts/DataRefreshContext'
import { useFeedPosts } from './useFeedPosts'
import { buildFeedTimeline, STATUS_COLORS, STATUS_LABELS } from './feedUtils'
import DateDivider from './DateDivider'
import FeedBubble from './FeedBubble'
import FeedSkeleton from './FeedSkeleton'
import './WorkFeed.css'

const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'FD'
}

export default function WorkFeed({ workDate, fullHeight = false }) {
  const { schemaName } = useAuth()
  const { revision } = useDataRefresh()
  const [searchParams] = useSearchParams()
  const [showJumpLatest, setShowJumpLatest] = useState(false)

  const search = (searchParams.get('q') || '').trim()

  const { posts, loading, error, hasMore, loadingMore, reload, loadMore } = useFeedPosts({
    workDate,
    allDates: true,
    schemaName,
    revision,
  })

  // Filtered posts
  const filteredPosts = useMemo(() => {
    if (!search) return posts
    const term = search.toLowerCase()
    return posts.filter((p) => {
      if (p.itemType === 'system') {
        const statusText = (STATUS_LABELS[p.status] || p.status || '').toLowerCase()
        return (
          String(p.updated_by_name || 'Admin').toLowerCase().includes(term) ||
          String(p.room_id || '').toLowerCase().includes(term) ||
          statusText.includes(term)
        )
      }
      return (
        String(p.cleaner_name || '').toLowerCase().includes(term) ||
        String(p.room_id || '').toLowerCase().includes(term) ||
        String(p.task_name || '').toLowerCase().includes(term) ||
        String(p.branch_id || '').toLowerCase().includes(term)
      )
    })
  }, [posts, search])

  const readStorageKey = `worktrack:feed-read:${schemaName || 'default'}`
  const [readIds, setReadIds] = useState(() => {
    try {
      const raw = window.localStorage.getItem(readStorageKey)
      const parsed = raw ? JSON.parse(raw) : []
      return new Set(Array.isArray(parsed) ? parsed : [])
    } catch {
      return new Set()
    }
  })

  const markRead = useCallback(
    (ids) => {
      if (!ids || ids.length === 0) return
      setReadIds((prev) => {
        let changed = false
        const next = new Set(prev)
        for (const id of ids) {
          if (id && !next.has(id)) {
            next.add(id)
            changed = true
          }
        }
        if (!changed) return prev
        try {
          window.localStorage.setItem(readStorageKey, JSON.stringify(Array.from(next).slice(-500)))
        } catch {
          /* ignore */
        }
        return next
      })
    },
    [readStorageKey],
  )

  const mediaCount = useMemo(
    () => filteredPosts.filter((p) => p.itemType !== 'system').length,
    [filteredPosts],
  )

  const unreadPostIds = useMemo(
    () =>
      filteredPosts
        .filter((p) => p.itemType !== 'system' && !readIds.has(p.post_id))
        .map((p) => p.post_id),
    [filteredPosts, readIds],
  )
  const unreadSet = useMemo(() => new Set(unreadPostIds), [unreadPostIds])

  const timeline = useMemo(() => buildFeedTimeline(filteredPosts), [filteredPosts])

  // Scroll handling
  const scrollRef = useRef(null)
  const bottomRef = useRef(null)
  const prevScrollHeightRef = useRef(0)

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }, [])

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => {
    if (!loading && filteredPosts.length > 0) {
      requestAnimationFrame(() => scrollToBottom(false))
    }
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const prevCountRef = useRef(0)
  useEffect(() => {
    const newCount = filteredPosts.length
    if (prevCountRef.current > 0 && newCount > prevCountRef.current) {
      if (isNearBottom()) scrollToBottom(true)
    }
    prevCountRef.current = newCount
  }, [filteredPosts.length, isNearBottom, scrollToBottom])

  useEffect(() => {
    if (!loadingMore) {
      const el = scrollRef.current
      if (!el) return
      const delta = el.scrollHeight - prevScrollHeightRef.current
      if (delta > 0) el.scrollTop += delta
    }
  }, [loadingMore])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    setShowJumpLatest(!isNearBottom())
    if (el.scrollTop < 80 && hasMore && !loadingMore) {
      prevScrollHeightRef.current = el.scrollHeight
      loadMore()
    }
  }

  return (
    <section
      className={`work-feed ${fullHeight ? 'work-feed--full' : ''}`}
      aria-label="Work feed"
    >
      {/* Scrolling feed body */}
      <div
        className="feed-body"
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Work feed messages"
      >
        {loadingMore && (
          <div className="feed-load-more-indicator" aria-live="polite">
            Loading older posts…
          </div>
        )}
        {hasMore && !loadingMore && (
          <div className="feed-load-more-indicator">
            Scroll up to see older posts
          </div>
        )}

        {loading ? (
          <FeedSkeleton count={4} />
        ) : error ? (
          <div className="feed-empty-state error" role="alert">
            <span className="feed-empty-icon">⚠️</span>
            <p>{error}</p>
            <button type="button" className="secondary-button" onClick={reload}>Retry</button>
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="feed-empty-state">
            <span className="feed-empty-icon">📭</span>
            <p>
              {search ? `No messages matching "${search}".` : 'No work posted yet.'}
            </p>
          </div>
        ) : (
          <div className="feed-messages">
            {(() => {
              let unreadDividerShown = false
              return timeline.map((item) => {
                if (item.type === 'divider') {
                  return <DateDivider key={item.key} date={item.date} />
                }
                if (item.type === 'system') {
                  const ev = item.event
                  const sender = ev.updated_by_name || 'Admin'
                  const statusLabel = STATUS_LABELS[ev.status] || ev.status || 'Updated'
                  const roomLabel = ev.room_id ? `Room ${ev.room_id}` : 'Room'
                  const timeLabel = ev.created_at ? TIME_FMT.format(new Date(ev.created_at)) : ''
                  const sc = STATUS_COLORS[ev.status] || {
                    dot: '#0369a1',
                    bg: 'rgba(3, 105, 161, 0.12)',
                    text: '#0369a1',
                    border: 'rgba(3, 105, 161, 0.35)',
                  }
                  return (
                    <article key={item.key} className="feed-bubble is-status-bubble">
                      <div
                        className="feed-avatar"
                        style={{ background: sc.dot }}
                        aria-hidden="true"
                        title={sender}
                      >
                        {initials(sender)}
                      </div>
                      <div className="feed-bubble-body" style={{ borderLeft: `3px solid ${sc.dot}` }}>
                        <span className="feed-sender" style={{ color: sc.dot }}>{sender}</span>
                        <div className="feed-caption" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>{roomLabel} ·</span>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: sc.bg,
                              color: sc.text,
                              border: `1px solid ${sc.border}`,
                              fontWeight: 600,
                              fontSize: '12px',
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: sc.dot,
                                display: 'inline-block',
                              }}
                            />
                            {statusLabel}
                          </span>
                        </div>
                        {timeLabel && (
                          <time className="feed-timestamp" dateTime={ev.created_at}>
                            {timeLabel}
                          </time>
                        )}
                      </div>
                    </article>
                  )
                }
                const bubbleIsUnread = item.posts.some((p) => unreadSet.has(p.post_id))
                const showUnreadDivider = bubbleIsUnread && !unreadDividerShown
                if (showUnreadDivider) unreadDividerShown = true
                return (
                  <div key={item.key}>
                    {showUnreadDivider && (
                      <div className="feed-unread-divider" role="status">
                        <span>
                          {unreadPostIds.length} unread{' '}
                          {unreadPostIds.length === 1 ? 'message' : 'messages'}
                        </span>
                      </div>
                    )}
                    <FeedBubble
                      posts={item.posts}
                      isUnread={bubbleIsUnread}
                      onMarkRead={markRead}
                    />
                  </div>
                )
              })
            })()}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {showJumpLatest && !loading && (
        <button
          type="button"
          className="feed-jump-latest"
          onClick={() => scrollToBottom(true)}
          aria-label="Jump to latest"
        >
          ↓ Latest
        </button>
      )}

      {/* Reserved for future "admin reply / note" message box */}
    </section>
  )
}
