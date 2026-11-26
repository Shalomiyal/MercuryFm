import { Link } from 'react-router-dom'

export default function Breadcrumbs({ items = [] }) {
  if (!items.length) return null
  return (
    <nav className="wt-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={`${item.label}-${index}`}>
              {index > 0 ? <span className="wt-breadcrumb-sep" aria-hidden="true">/</span> : null}
              {item.to && !isLast ? (
                <Link to={item.to} className="wt-breadcrumb-link">{item.label}</Link>
              ) : (
                <span className={isLast ? 'wt-breadcrumb-current' : 'wt-breadcrumb-link'}>
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
