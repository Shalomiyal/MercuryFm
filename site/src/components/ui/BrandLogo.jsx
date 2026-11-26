import { useId } from 'react'

export default function BrandLogo({ collapsed = false, subtitle = '' }) {
  const maskId = useId()

  return (
    <div className={`wt-brand ${collapsed ? 'is-collapsed' : ''}`}>
      <span className="wt-brand-mark" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 64 64" fill="none">
          <defs>
            <mask id={maskId}>
              <rect width="64" height="64" fill="#fff" />
              <circle cx="56" cy="53" r="31" fill="#000" />
            </mask>
          </defs>
          <path
            d="M8 53V11H21L32 26L43 11H56V53H43V28L32 42L21 28V53H8Z"
            fill="#9B1B30"
            mask={`url(#${maskId})`}
          />
          <path d="M56 53H48.5A7.5 7.5 0 0 1 56 45.5V53Z" fill="#C59B4E" />
          <path
            d="M40.5 53A15.5 15.5 0 0 1 56 37.5"
            stroke="#C59B4E"
            strokeWidth="5.2"
            strokeLinecap="butt"
          />
          <path
            d="M30.5 53A25.5 25.5 0 0 1 56 27.5"
            stroke="#C59B4E"
            strokeWidth="5.2"
            strokeLinecap="butt"
          />
        </svg>
      </span>
      {!collapsed && (
        <div className="wt-brand-text">
          <span className="wt-brand-name">Work Track</span>
          {subtitle ? <span className="wt-brand-subtitle">{subtitle}</span> : null}
        </div>
      )}
    </div>
  )
}
