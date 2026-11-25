import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import DataRefreshBar from './ui/DataRefreshBar'

function IconBuilding() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>
      <path d="M6 12H4a2 2 0 0 0-2 2v8h4"/>
      <path d="M18 9h2a2 2 0 0 1 2 2v11h-4"/>
      <path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>
    </svg>
  )
}

function IconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}

function IconDashboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="9" x="3" y="3" rx="1"/>
      <rect width="7" height="5" x="14" y="3" rx="1"/>
      <rect width="7" height="9" x="14" y="12" rx="1"/>
      <rect width="7" height="5" x="3" y="16" rx="1"/>
    </svg>
  )
}

function IconDoor() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )
}

function IconTasks() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  )
}

function IconTemplate() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )
}

function IconHistory() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  )
}

function IconRoomsSetup() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 9h18"/>
      <path d="M9 21V9"/>
    </svg>
  )
}

function IconSignOut() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  )
}

export default function AppShell({ role }) {
  const { profile, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const platformTabs = [
    ['Organizations', '/platform', IconBuilding],
    ['User management', '/platform/users', IconUsers],
  ]
  const adminTabs = [
    ['Dashboard', '/admin', IconDashboard],
    ['Room status', '/admin/rooms', IconDoor],
    ['Daily tasks', '/admin/tasks', IconTasks],
    ['Templates', '/admin/templates', IconTemplate],
    ...(profile?.role === 'org_admin'
      ? [
          ['Rooms setup', '/admin/rooms-setup', IconRoomsSetup],
          ['Users', '/admin/users', IconUsers],
        ]
      : []),
  ]
  const cleanerTabs = [
    ['Tasks', '/cleaner/tasks', IconTasks],
    ['History', '/cleaner/history', IconHistory],
  ]
  const tabs = role === 'platform'
    ? platformTabs
    : role === 'cleaner'
      ? cleanerTabs
      : adminTabs

  const currentTab = tabs.find(([_, path]) => path === location.pathname)
  const currentTabLabel = currentTab ? currentTab[0] : (role === 'platform' ? 'Platform' : 'Dashboard')

  const roleTitle = role === 'platform'
    ? 'Platform Manager'
    : profile?.role === 'org_admin'
      ? 'Organization Admin'
      : role === 'admin'
        ? 'Facility Admin'
        : 'Cleaning Staff'

  const userInitial = profile?.full_name?.charAt(0)?.toUpperCase() || profile?.email?.charAt(0)?.toUpperCase() || 'U'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <strong>MERCURY</strong>
            <small>FM</small>
          </div>
        </div>

        <nav className="nav-links" aria-label="Primary navigation">
          {tabs.map(([label, path, IconComponent]) => (
            <NavLink key={path} to={path} end={path === '/admin' || path === '/cleaner/tasks'}>
              {IconComponent && <IconComponent />}
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User Card at Sidebar Bottom */}
        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div className="avatar" style={{ width: 34, height: 34, minWidth: 34, fontSize: 13 }}>
              {userInitial}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile?.full_name || 'Account'}
              </p>
              <small style={{ color: '#64748b', fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {roleTitle}
              </small>
            </div>
          </div>
          <button className="sign-out" type="button" onClick={handleSignOut} style={{ width: '100%' }}>
            <IconSignOut />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div>
              <p className="eyebrow" style={{ margin: 0, fontSize: 10 }}>Mercury FM • {roleTitle}</p>
              <h1 style={{ fontSize: 18, margin: 0 }}>{currentTabLabel}</h1>
            </div>
          </div>

          <div className="topbar-actions">
            <DataRefreshBar />
            <button
              type="button"
              className="icon-button theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: '#f1f5f9',
                color: '#475569',
              }}
            >
              {roleTitle}
            </span>
            <div className="avatar" title={profile?.full_name || profile?.email || 'User'}>
              {userInitial}
            </div>
            <button className="sign-out mobile-sign-out" type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  )
}
