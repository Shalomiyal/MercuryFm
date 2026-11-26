// WorkFeed.jsx — admin Work Feed: WhatsApp-style scrolling media timeline
// Placed below the assignment section in DailyTasksPage.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useDataRefresh } from '../../contexts/DataRefreshContext'
import { useFeedPosts } from './useFeedPosts'
import { buildFeedTimeline, formatDividerLabel, formatSystemMessage } from './feedUtils'
import DateDivider from './DateDivider'
import FeedBubble from './FeedBubble'
import FeedFilters from './FeedFilters'
import FeedSkeleton from './FeedSkeleton'
import './WorkFeed.css'

const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

function formatLastUpdated(ts) {
  if (!ts) return 'Never'
  const diff = Date.now() - ts
  if (diff < 10_000) return 'just now'
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`
  return TIME_FMT.format(new Date(ts))
}

export default function WorkFeed({ workDate, cleaners = [], branches = [], fullHeight = false }) {
  const { schemaName } = useAuth()
  const { revision } = useDataRefresh()
  const [isMobile, setIsMobile] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(Date.now())
  const [showJumpLatest, setShowJumpLatest] = useState(false)

  const [filters, setFilters] = useState({
    date: workDate,
    allDates: false,
    cleaner: '',
    branch: '',
    type: '',
    search: '',
  })

  useEffect(() => {
    setFilters((f) => ({ ...f, date: workDate }))
  }, [workDate])

  const { posts, loading, error, hasMore, loadingMore, reload, loadMore, isMock } = useFeedPosts({
    workDate: filters.date,
    allDates: filters.allDates,
    schemaName,
    revision,
  })

  // Derive branch options from both prop and feed items
  const branchOptions = useMemo(() => {
    const set = new Set((branches || []).map((b) => b.branch_id).filter(Boolean))
    for (const p of posts) {
      if (p.branch_id) set.add(p.branch_id)
    }
    return [...set].sort().map((branch_id) => ({ branch_id }))
  }, [branches, posts])

  // Filtered posts
  const filteredPosts = useMemo(() => {
    let result = posts
    if (filters.cleaner) {
      result = result.filter((p) => p.itemType === 'system' || p.cleaner_id === filters.cleaner)
    }
    if (filters.branch) {
      result = result.filter((p) => p.itemType === 'system' || p.branch_id === filters.branch)
    }
    if (filters.type) {
      result = result.filter((p) => p.itemType === 'media' && p.kind === filters.type)
    }
    if (filters.search) {
      const term = filters.search.toLowerCase()
      result = result.filter((p) => {
        if (p.itemType === 'system') {
          return String(p.room_id || '').toLowerCase().includes(term)
        }
        return (
          String(p.room_id || '').toLowerCase().includes(term) ||
          String(p.task_name || '').toLowerCase().includes(term) ||
          String(p.cleaner_name || '').toLowerCase().includes(term) ||
          String(p.branch_id || '').toLowerCase().includes(term)
        )
      })
    }
    return result
  }, [posts, filters])

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

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    setIsMobile(mq.matches)
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    setLastUpdated(Date.now())
  }, [posts])

  useEffect(() => {
    const timer = setInterval(() => setLastUpdated((t) => t), 20_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <section
      className={`work-feed ${fullHeight ? 'work-feed--full' : ''}`}
      aria-labelledby="work-feed-title"
    >
      {/* Chat header */}
      <div className="feed-header">
        <div className="feed-header-left">
          <div className="feed-header-icon" aria-hidden="true">💬</div>
          <div>
            <div className="feed-title-row">
              <h3 id="work-feed-title" className="feed-title">Work feed</h3>
              <span className="feed-count-pill">{mediaCount}</span>
              {unreadPostIds.length > 0 && (
                <>
                  <span className="feed-unread-pill">{unreadPostIds.length} unread</span>
                  <button
                    type="button"
                    className="feed-mark-read-btn"
                    onClick={() => markRead(unreadPostIds)}
                  >
                    Mark all read
                  </button>
                </>
              )}
            </div>
            <p className="feed-subtitle">
              {isMock
                ? 'Sample data — upload real media to see live feed'
                : `Updated ${formatLastUpdated(lastUpdated)}`}
            </p>
          </div>
        </div>

        <div className="feed-header-right">
          <FeedFilters
            filters={filters}
            onChange={setFilters}
            cleaners={cleaners}
            branches={branchOptions}
            isMobile={isMobile}
          />
          <button
            type="button"
            className="secondary-button refresh-button"
            onClick={() => {
              reload()
              setLastUpdated(Date.now())
            }}
            aria-label="Refresh feed"
            title="Refresh"
          >
            ↺
          </button>
        </div>
      </div>

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
              No work posted yet
              {!filters.allDates && filters.date ? ` for ${formatDividerLabel(filters.date)}` : ''}.
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
                  return (
                    <div key={item.key} className="feed-system-event" role="status">
                      <span>{formatSystemMessage(item.event)}</span>
                    </div>
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
