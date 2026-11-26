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

/**
 * Groups chronological feed items (media posts + system events):
 * - Inserts sticky date dividers when the calendar day changes.
 * - Keeps system events as centered rows.
 * - Groups consecutive media posts from the same cleaner for the same task
 *   posted within 5 minutes into a single multi-tile bubble.
 */
export function buildFeedTimeline(items) {
  const sorted = [...(items || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  const timeline = []
  let lastDate = ''

  for (const item of sorted) {
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
