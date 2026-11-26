export default function EmptyState({
  title = 'Nothing here yet',
  description = '',
  icon = null,
  action = null,
  compact = false,
  tone = 'default',
}) {
  return (
    <div
      className={`wt-empty-state ${compact ? 'is-compact' : ''} ${tone === 'error' ? 'is-error' : ''}`}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {icon ? <div className="wt-empty-icon">{icon}</div> : null}
      <p className="wt-empty-title">{title}</p>
      {description ? <p className="wt-empty-desc">{description}</p> : null}
      {action ? <div className="wt-empty-action">{action}</div> : null}
    </div>
  )
}
