import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ role, roles }) {
  const { session, profile, schemaName, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="page-state">Loading...</div>
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (!profile) {
    return <div className="page-state error">Your account profile could not be loaded.</div>
  }
  if (
    profile.email_verified === false &&
    !['/verify-email', '/reset-password'].includes(location.pathname)
  ) {
    return (
      <Navigate
        to="/verify-email"
        replace
        state={{ email: session?.user?.email, fullName: profile?.full_name }}
      />
    )
  }
  if (profile.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  const allowedRoles = roles || (role ? [role] : null)
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    if (profile.role === 'platform_admin') {
      return <Navigate to="/platform" replace />
    }
    if (profile.role === 'cleaner') {
      return <Navigate to="/cleaner/tasks" replace />
    }
    return <Navigate to="/admin" replace />
  }
  if (profile.role !== 'platform_admin' && !schemaName) {
    return (
      <div className="page-state error">
        Your organization is unavailable or inactive.
      </div>
    )
  }
  return <Outlet />
}
