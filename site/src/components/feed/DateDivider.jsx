// DateDivider.jsx — sticky centered date pill separator
import { useMemo } from 'react'
import { formatDividerLabel } from './feedUtils'

export { formatDividerLabel }

export default function DateDivider({ date }) {
  const label = useMemo(() => formatDividerLabel(date), [date])
  return (
    <div className="feed-date-divider" role="separator" aria-label={label}>
      <span className="feed-date-pill">{label}</span>
    </div>
  )
}
