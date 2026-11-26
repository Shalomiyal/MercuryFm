import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'motion/react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import DataRefreshBar from './ui/DataRefreshBar'
import PageTransition from './PageTransition'
import BrandLogo from './ui/BrandLogo'
import Breadcrumbs from './ui/Breadcrumbs'
import Avatar from './ui/Avatar'

function IconDashboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="2" />
      <rect x="14" y="3" width="7" height="5" rx="2" />
      <rect x="14" y="12" width="7" height="9" rx="2" />
      <rect x="3" y="16" width="7" height="5" rx="2" />
    </svg>
  )
}

function IconTracks() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function IconTasks() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

function IconFeed() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  )
}

function IconHistory() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  )
}

function IconSetup() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function IconBuilding() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </svg>
  )
}

function IconCollapse({ collapsed }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {collapsed ? (
        <>
          <polyline points="9 18 15 12 9 6" />
        </>
      ) : (
        <>
          <polyline points="15 18 9 12 15 6" />
        </>
      )}
    </svg>
  )
}

function IconSignOut() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

const SIDEBAR_STORAGE_KEY = 'worktrack:sidebar-collapsed'

export default function AppShell({ role }) {
  const { profile, signOut } = useAuth()
  const { theme, setThemeMode } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [quickQuery, setQuickQuery] = useState('')
  const profileRef = useRef(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  useEffect(() => {
    setMobileMenuOpen(false)
    setProfileOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!profileOpen) return undefined
    const handleOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [profileOpen])

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const sections = useMemo(() => {
    if (role === 'platform') {
      return [
        {
          title: 'PLATFORM',
          items: [
            { label: 'Organizations', path: '/platform', icon: IconBuilding },
            { label: 'User Management', path: '/platform/users', icon: IconUsers },
          ],
        },
      ]
    }
    if (role === 'cleaner') {
      return [
        {
          title: 'OPERATIONS',
          items: [
            { label: 'My Tasks', path: '/cleaner/tasks', icon: IconTasks },
            { label: 'Activity History', path: '/cleaner/history', icon: IconHistory },
          ],
        },
      ]
    }
    return [
      {
        title: 'OVERVIEW',
        items: [{ label: 'Dashboard', path: '/admin', icon: IconDashboard }],
      },
      {
        title: 'OPERATIONS',
        items: [
          { label: 'Work Tracks', path: '/admin/rooms', icon: IconTracks },
          { label: 'Daily Tasks', path: '/admin/tasks', icon: IconTasks },
          { label: 'Photo & Video Records', path: '/admin/feed', icon: IconFeed },
        ],
      },
      ...(profile?.role === 'org_admin'
        ? [
            {
              title: 'ADMINISTRATION',
              items: [
                { label: 'Work Track Setup', path: '/admin/rooms-setup', icon: IconSetup },
                { label: 'Staff & Users', path: '/admin/users', icon: IconUsers },
              ],
            },
          ]
        : []),
    ]
  }, [role, profile?.role])

  const flatItems = useMemo(() => sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title }))), [sections])
  const currentItem = flatItems.find((item) => item.path === location.pathname)
  const currentLabel = currentItem?.label || (role === 'platform' ? 'Platform' : 'Dashboard')
  const roleTitle =
    role === 'platform'
      ? 'Platform Admin'
      : profile?.role === 'org_admin'
        ? 'Organization Admin'
        : role === 'admin'
          ? 'Operations Admin'
          : 'Staff Member'

  function handleQuickJump(event) {
    event.preventDefault()
    const term = quickQuery.trim().toLowerCase()
    if (!term) return
    const match = flatItems.find((item) => item.label.toLowerCase().includes(term))
    if (match) {
      navigate(match.path)
      setQuickQuery('')
    }
  }

  const breadcrumbs = useMemo(() => {
    const items = [{ label: 'Work Track', to: flatItems[0]?.path || '/' }]
    if (currentItem?.section) {
      items.push({ label: currentItem.section.charAt(0) + currentItem.section.slice(1).toLowerCase() })
    }
    items.push({ label: currentLabel })
    return items
  }, [flatItems, currentItem, currentLabel])

  return (
    <div className={`wt-shell ${collapsed ? 'is-collapsed' : ''}`}>
      {mobileMenuOpen ? (
        <div className="wt-mobile-backdrop" onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />
      ) : null}

      <aside className={`wt-sidebar ${mobileMenuOpen ? 'is-mobile-open' : ''}`} aria-label="Primary navigation">
        <div className="wt-sidebar-top">
          <BrandLogo collapsed={collapsed} subtitle={role === 'platform' ? 'Platform' : 'Operations'} />
          <button
            type="button"
            className="wt-collapse-btn"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <IconCollapse collapsed={collapsed} />
          </button>
        </div>

        <nav className="wt-sidebar-nav">
          {sections.map((section) => (
            <div className="wt-nav-section" key={section.title}>
              {!collapsed ? <p className="wt-nav-section-label">{section.title}</p> : <div className="wt-nav-divider" />}
              <div className="wt-nav-list">
                {section.items.map(({ label, path, icon: Icon }) => (
                  <NavLink
                    key={path}
                    to={path}
                    end={path === '/admin' || path === '/platform'}
                    title={collapsed ? label : undefined}
                    className={({ isActive }) => `wt-nav-link ${isActive ? 'active' : ''}`}
                  >
                    <span className="wt-nav-icon">
                      <Icon />
                    </span>
                    {!collapsed ? <span className="wt-nav-label">{label}</span> : null}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="wt-sidebar-footer">
          <div className="wt-sidebar-user" title={collapsed ? `${profile?.full_name || 'User'} (${roleTitle})` : undefined}>
            <Avatar name={profile?.full_name || 'User'} size="sm" />
            {!collapsed ? (
              <div className="wt-sidebar-user-meta">
                <strong>{profile?.full_name || 'Team Member'}</strong>
                <span>{roleTitle}</span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="wt-sidebar-signout"
            onClick={handleSignOut}
            title={collapsed ? 'Sign out' : undefined}
            aria-label="Sign out"
          >
            <IconSignOut />
            {!collapsed ? <span>Sign out</span> : null}
          </button>
        </div>
      </aside>

      <div className="wt-main">
        <header className="wt-topbar">
          <div className="wt-topbar-left">
            <button
              type="button"
              className="wt-mobile-menu-btn"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="Toggle navigation menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div className="wt-topbar-title-group">
              <Breadcrumbs items={breadcrumbs} />
              <h1 className="wt-topbar-title">{currentLabel}</h1>
            </div>
          </div>

          <div className="wt-topbar-right">
            <form className="wt-global-search" onSubmit={handleQuickJump} role="search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                value={quickQuery}
                onChange={(e) => setQuickQuery(e.target.value)}
                placeholder="Jump to page..."
                aria-label="Jump to page"
                list="wt-nav-jump-list"
              />
              <datalist id="wt-nav-jump-list">
                {flatItems.map((item) => (
                  <option key={item.path} value={item.label} />
                ))}
              </datalist>
            </form>

            <DataRefreshBar />

            <div className="wt-theme-switch" role="group" aria-label="Theme mode">
              {['light', 'dark'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`wt-theme-btn ${theme === mode ? 'active' : ''}`}
                  onClick={() => setThemeMode(mode)}
                  title={`${mode === 'light' ? 'Light' : 'Dark'} mode`}
                  aria-label={`${mode} theme`}
                >
                  {mode === 'light' ? '☀' : '☾'}
                </button>
              ))}
            </div>

            <div className="wt-profile-menu" ref={profileRef}>
              <button
                type="button"
                className="wt-profile-trigger"
                onClick={() => setProfileOpen((prev) => !prev)}
                aria-expanded={profileOpen}
                aria-label="User menu"
              >
                <Avatar name={profile?.full_name || 'User'} size="sm" />
              </button>
              {profileOpen ? (
                <div className="wt-profile-dropdown" role="menu">
                  <div className="wt-profile-dropdown-header">
                    <strong>{profile?.full_name || 'Team Member'}</strong>
                    <span>{roleTitle}</span>
                  </div>
                  <button
                    type="button"
                    className="wt-dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false)
                      navigate('/change-password')
                    }}
                  >
                    Change password
                  </button>
                  <button
                    type="button"
                    className="wt-dropdown-item is-danger"
                    role="menuitem"
                    onClick={handleSignOut}
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="wt-main-content">
          <AnimatePresence mode="wait">
            <PageTransition key={location.pathname}>
              <Outlet />
            </PageTransition>
          </AnimatePresence>
        </main>
      </div>

      <nav className="wt-mobile-bottom-nav" aria-label="Mobile quick navigation">
        {flatItems.slice(0, 4).map(({ label, path, icon: Icon }) => {
          const shortLabel =
            label === 'Dashboard'
              ? 'Home'
              : label === 'Work Tracks'
                ? 'Tracks'
                : label === 'Daily Tasks' || label === 'My Tasks'
                  ? 'Tasks'
                  : label === 'Activity History'
                    ? 'History'
                    : label === 'Photo & Video Records'
                      ? 'Records'
                      : label.split(' ')[0]
          return (
            <NavLink
              key={path}
              to={path}
              end={path === '/admin' || path === '/platform'}
              className={({ isActive }) => `wt-mobile-nav-link ${isActive ? 'active' : ''}`}
            >
              <Icon />
              <span>{shortLabel}</span>
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
