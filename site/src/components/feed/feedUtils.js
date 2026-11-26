// feedUtils.js — pure helpers for date formatting, grouping, and system events

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

export const STATUS_LABELS = {
  check_in: 'Checked in',
  check_out: 'Checked out',
  clean_start: 'Clean started',
  clean_finished: 'Clean finished',
  ready: 'Marked Ready',
}

export const STATUS_COLORS = {
  ready: {
    dot: '#16a34a',
    bg: 'rgba(22, 163, 74, 0.14)',
    text: '#15803d',
    border: 'rgba(22, 163, 74, 0.35)',
  },
  check_in: {
    dot: '#dc2626',
    bg: 'rgba(220, 38, 38, 0.14)',
    text: '#dc2626',
    border: 'rgba(220, 38, 38, 0.35)',
  },
  check_out: {
    dot: '#eab308',
    bg: 'rgba(234, 179, 8, 0.18)',
    text: '#a16207',
    border: 'rgba(234, 179, 8, 0.45)',
  },
  clean_start: {
    dot: '#2563eb',
    bg: 'rgba(37, 99, 235, 0.14)',
    text: '#2563eb',
    border: 'rgba(37, 99, 235, 0.35)',
  },
  clean_finished: {
    dot: '#ea580c',
    bg: 'rgba(234, 88, 12, 0.14)',
    text: '#ea580c',
    border: 'rgba(234, 88, 12, 0.35)',
  },
}

export function formatDividerLabel(isoDate, todayStr, yesterdayStr) {
  const today = todayStr || new Date().toISOString().slice(0, 10)
  const yesterday = yesterdayStr || new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
  if (isoDate === today) return 'Today'
  if (isoDate === yesterday) return 'Yesterday'
  return DATE_FMT.format(new Date(`${isoDate}T12:00:00`))
}

export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return ''
  const total = Math.max(0, Math.round(Number(seconds)))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function formatSystemMessage(event) {
  const label = STATUS_LABELS[event.status] || event.status
  const time = event.created_at ? TIME_FMT.format(new Date(event.created_at)) : ''
  const room = event.room_id ? `Room ${event.room_id}` : 'Room'
  const core = event.updated_by_name
    ? `${event.updated_by_name} updated ${room} to ${label}`
    : `${room} · ${label}`
  return time ? `${core} · ${time}` : core
}

const GROUP_WINDOW_MS = 5 * 60 * 1000
const SYSTEM_DEDUP_MS = 90_000 // collapse duplicate status events within 90 seconds

/**
 * Groups chronological feed items (media posts + system events):
 * - Inserts sticky date dividers when the calendar day changes.
 * - Deduplicates consecutive system events for the same room + status
 *   that occur within 90 seconds (keeps the first, which carries the media link).
 * - Groups consecutive media posts from the same cleaner for the same task
 *   posted within 5 minutes into a single multi-tile bubble.
 */
export function buildFeedTimeline(items) {
  const sorted = [...(items || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  // Deduplicate system events: same room_id + status within SYSTEM_DEDUP_MS
  const deduped = []
  for (const item of sorted) {
    if (item.itemType === 'system') {
      const dup = deduped.find(
        (prev) =>
          prev.itemType === 'system' &&
          prev.room_id === item.room_id &&
          prev.status === item.status &&
          Math.abs(
            new Date(item.created_at).getTime() - new Date(prev.created_at).getTime(),
          ) < SYSTEM_DEDUP_MS,
      )
      if (dup) {
        // Keep the one that has media attached; prefer the earlier one otherwise
        if (!dup.storage_path && !dup.thumb_path && (item.storage_path || item.thumb_path)) {
          Object.assign(dup, { storage_path: item.storage_path, thumb_path: item.thumb_path })
        }
        continue // skip this duplicate
      }
    }
    deduped.push(item)
  }

  const timeline = []
  let lastDate = ''

  for (const item of deduped) {
    const date = item.created_at ? item.created_at.slice(0, 10) : ''
    if (date && date !== lastDate) {
      timeline.push({ type: 'divider', date, key: `divider-${date}` })
      lastDate = date
    }

    if (item.itemType === 'system') {
      timeline.push({ type: 'system', event: item, key: item.post_id })
      continue
    }

    const prev = timeline[timeline.length - 1]
    const prevLastPost = prev?.type === 'bubble' ? prev.posts[prev.posts.length - 1] : null
    const canGroup =
      prevLastPost &&
      prevLastPost.cleaner_id === item.cleaner_id &&
      prevLastPost.daily_task_id === item.daily_task_id &&
      prevLastPost.stage === item.stage &&
      Math.abs(new Date(item.created_at).getTime() - new Date(prevLastPost.created_at).getTime()) <=
        GROUP_WINDOW_MS

    if (canGroup) {
      prev.posts.push(item)
    } else {
      timeline.push({
        type: 'bubble',
        key: item.post_id,
        posts: [item],
      })
    }
  }

  return timeline
}
