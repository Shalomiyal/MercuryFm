export default function PageHeader({
  eyebrow = '',
  title,
  subtitle = '',
  actions = null,
}) {
  return (
    <header className="wt-page-header">
      <div className="wt-page-header-copy">
        {eyebrow ? <p className="wt-eyebrow">{eyebrow}</p> : null}
        <h2 className="wt-page-title">{title}</h2>
        {subtitle ? <p className="wt-page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="wt-page-header-actions">{actions}</div> : null}
    </header>
  )
}
