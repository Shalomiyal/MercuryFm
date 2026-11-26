export default function ChartCard({
  title,
  subtitle = '',
  action = null,
  children,
  className = '',
}) {
  return (
    <section className={`wt-card wt-chart-card ${className}`}>
      <header className="wt-card-header">
        <div>
          <h3 className="wt-card-title">{title}</h3>
          {subtitle ? <p className="wt-card-subtitle">{subtitle}</p> : null}
        </div>
        {action ? <div className="wt-card-action">{action}</div> : null}
      </header>
      <div className="wt-chart-body">{children}</div>
    </section>
  )
}
