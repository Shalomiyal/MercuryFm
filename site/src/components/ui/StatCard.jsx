import AnimatedNumber from '../AnimatedNumber'

export default function StatCard({
  label,
  value,
  sublabel = '',
  icon = null,
  tone = 'primary',
  numeric = true,
  onClick,
}) {
  const Tag = onClick ? 'button' : 'article'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`wt-stat-card wt-tone-${tone} ${onClick ? 'is-interactive' : ''}`}
    >
      <div className="wt-stat-top">
        <span className="wt-stat-label">{label}</span>
        {icon ? <span className={`wt-stat-icon wt-tone-${tone}`}>{icon}</span> : null}
      </div>
      <div className="wt-stat-value">
        {numeric && typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
      </div>
      {sublabel ? <p className="wt-stat-sublabel">{sublabel}</p> : null}
    </Tag>
  )
}
