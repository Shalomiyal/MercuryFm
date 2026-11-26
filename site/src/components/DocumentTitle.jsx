import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const TITLES = {
  '/login': 'Sign in · Work Track',
  '/signup': 'Create account · Work Track',
  '/forgot-password': 'Reset password · Work Track',
  '/auth/callback': 'Signing in · Work Track',
  '/platform-login': 'Platform sign in · Work Track',
  '/reset-password': 'Set password · Work Track',
  '/verify-email': 'Verify email · Work Track',
  '/change-password': 'Change password · Work Track',
  '/platform': 'Organizations · Work Track',
  '/platform/users': 'User management · Work Track',
  '/admin': 'Dashboard · Work Track',
  '/admin/rooms': 'Work Tracks · Work Track',
  '/admin/tasks': 'Daily Tasks · Work Track',
  '/admin/feed': 'Photo & Video Records · Work Track',
  '/admin/templates': 'Daily Tasks · Work Track',
  '/admin/users': 'Staff & Users · Work Track',
  '/admin/rooms-setup': 'Work Track Setup · Work Track',
  '/cleaner/tasks': 'My Tasks · Work Track',
  '/cleaner/history': 'Activity History · Work Track',
}

export default function DocumentTitle() {
  const { pathname } = useLocation()

  useEffect(() => {
    document.title = TITLES[pathname] || 'Page not found · Work Track'
  }, [pathname])

  return null
}
