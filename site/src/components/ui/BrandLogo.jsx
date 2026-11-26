export default function BrandLogo({ collapsed = false, subtitle = '' }) {
  return (
    <div className={`wt-brand ${collapsed ? 'is-collapsed' : ''}`}>
      <span className="wt-brand-mark" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="9" fill="url(#wtLogoGrad)" />
          <path
            d="M8.5 16.5L13.2 21.2L23.5 10.8"
            stroke="#FFFFFF"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="23.5" cy="10.8" r="2.2" fill="#16B8A6" stroke="#FFFFFF" strokeWidth="1.2" />
          <defs>
            <linearGradient id="wtLogoGrad" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#635BDB" />
              <stop offset="1" stopColor="#8580F5" />
            </linearGradient>
          </defs>
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
