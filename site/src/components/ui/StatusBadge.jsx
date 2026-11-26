const STATUS_TONES = {
  completed: 'success',
  ready: 'success',
  active: 'success',
  clean_finished: 'info',
  in_progress: 'info',
  clean_start: 'warning',
  pending: 'warning',
  not_started: 'neutral',
  none: 'neutral',
  inactive: 'neutral',
  check_in: 'brand',
  check_out: 'warning',
  overdue: 'error',
  error: 'error',
}

export default function StatusBadge({ status = 'none', label, showDot = true, className = '' }) {
  const tone = STATUS_TONES[status] || 'neutral'
  const text =
    label ||
    String(status || 'None')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())

  return (
    <span className={`wt-badge wt-badge-${tone} ${className}`}>
      {showDot ? <span className="wt-badge-dot" aria-hidden="true" /> : null}
      <span>{text}</span>
    </span>
  )
}
