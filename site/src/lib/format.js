const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

export function formatDateTime(value) {
  if (!value) return 'Not set'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return DATE_TIME_FORMAT.format(date)
}

export function formatTime(value) {
  if (!value) return 'Not set'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return TIME_FORMAT.format(date)
}

export function formatRelative(value, now = Date.now()) {
  if (!value) return 'just now'
  const timestamp = typeof value === 'number' ? value : new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'just now'
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// Turns raw database/auth errors into short, actionable messages. Detailed
// errors stay in the browser console for support, not in the UI.
export function friendlyError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  if (!message) return 'Something went wrong. Please try again.'
  if (/failed to fetch|networkerror|load failed|timeout|timed out/.test(message)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (/jwt|expired|session|refresh token|not authenticated/.test(message)) {
    return 'Your session expired. Please sign in again.'
  }
  if (/permission denied|rls|not authorized|forbidden|insufficient/.test(message)) {
    return 'You do not have access to that information.'
  }
  if (/duplicate|already exists|unique constraint/.test(message)) {
    return 'That record already exists.'
  }
  if (/foreign key|does not exist/.test(message)) {
    return 'A related record could not be found. Refresh and try again.'
  }
  return error?.message || 'Could not complete the request. Please try again.'
}
