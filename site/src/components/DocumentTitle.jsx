import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const TITLES = {
  '/login': 'Sign in · Mercury FM',
  '/signup': 'Create account · Mercury FM',
  '/forgot-password': 'Reset password · Mercury FM',
  '/auth/callback': 'Signing in · Mercury FM',
  '/platform-login': 'Platform sign in · Mercury FM',
  '/reset-password': 'Set password · Mercury FM',
  '/verify-email': 'Verify email · Mercury FM',
  '/change-password': 'Change password · Mercury FM',
  '/platform': 'Organizations · Mercury FM',
  '/platform/users': 'User management · Mercury FM',
  '/admin': 'Dashboard · Mercury FM',
  '/admin/rooms': 'Room status · Mercury FM',
  '/admin/tasks': 'Daily tasks · Mercury FM',
  '/admin/templates': 'Templates · Mercury FM',
  '/admin/users': 'Users · Mercury FM',
  '/admin/rooms-setup': 'Rooms setup · Mercury FM',
  '/cleaner/tasks': 'My tasks · Mercury FM',
  '/cleaner/history': 'History · Mercury FM',
}

export default function DocumentTitle() {
  const { pathname } = useLocation()

  useEffect(() => {
    document.title = TITLES[pathname] || 'Page not found · Mercury FM'
  }, [pathname])

  return null
}
