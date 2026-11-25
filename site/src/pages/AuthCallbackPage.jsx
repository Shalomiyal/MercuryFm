import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  clearPendingAuthFlow,
  getPendingAuthFlow,
  homeForRole,
} from '../lib/authFlow'

function linkErrorFromUrl() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const search = new URLSearchParams(window.location.search)
  const message = hash.get('error_description') || search.get('error_description')
  const code = hash.get('error') || search.get('error')
  if (!message && !code) return ''
  const raw = message || code || 'Sign-in link error'
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

export default function AuthCallbackPage() {
  const { session, profile, loading } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState('processing')
  const [message, setMessage] = useState('')
  const bootRef = useRef(false)
  const flowRef = useRef(false)

  useEffect(() => {
    if (loading || bootRef.current) return
    bootRef.current = true

    const linkError = linkErrorFromUrl()
    if (linkError) {
      setStatus('error')
      setMessage('This link could not be used. Request a new one and try again.')
      return
    }
    if (!session) {
      setStatus('error')
      setMessage('This link is invalid or has expired. Request a new link.')
      return
    }

    const flow = getPendingAuthFlow()
    if (flow?.type === 'signup') {
      // Older magic-link signups are retired. The current flow is
      // /start-signup -> /send-code -> /verify-code with an invite code.
      clearPendingAuthFlow()
      navigate('/verify-email', {
        replace: true,
        state: { email: session.user.email, fullName: flow.fullName || '' },
      })
      return
    }
    if (flow?.type === 'recovery') {
      navigate('/reset-password', { replace: true })
    }
  }, [loading, session, navigate])

  useEffect(() => {
    if (status !== 'processing' || loading || !session) return
    if (!profile) {
      const timer = setTimeout(() => {
        setStatus('error')
        setMessage('Your account profile could not be loaded. Please sign in again.')
      }, 8000)
      return () => clearTimeout(timer)
    }
    if (flowRef.current) return
    flowRef.current = true
    if (profile.must_change_password) {
      navigate('/change-password', { replace: true })
      return
    }
    navigate(homeForRole(profile.role), { replace: true })
  }, [status, loading, session, profile, navigate])

  if (status === 'error') {
    return (
      <main className="login-page">
        <section className="login-card" aria-labelledby="auth-callback-title">
          <div>
            <p className="eyebrow">Email verification</p>
            <h1 id="auth-callback-title">Link could not be used</h1>
          </div>
          <p className="form-error" role="alert">{message}</p>
          <Link className="primary-button" to="/login">Back to login</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="auth-callback-title">
        <div>
          <p className="eyebrow">Email verification</p>
          <h1 id="auth-callback-title">Completing sign-in...</h1>
        </div>
        <p role="status">Please wait while your email link is verified.</p>
      </section>
    </main>
  )
}
