import { useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { authCallbackUrl, setPendingAuthFlow } from '../lib/authFlow'

export default function ForgotPasswordPage() {
  const location = useLocation()
  const [email, setEmail] = useState(location.state?.email || '')
  const [organizationId, setOrganizationId] = useState(location.state?.organizationId || '')
  const [isPlatform, setIsPlatform] = useState(Boolean(location.state?.platform))
  const [linkSent, setLinkSent] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    setIsPlatform(Boolean(location.state?.platform))
  }, [location.state])

  async function sendLink(event) {
    event.preventDefault()
    setError('')
    if (!email.trim()) {
      setError('Enter your email.')
      return
    }
    if (!isPlatform && !organizationId.trim()) {
      setError('Enter your Organization ID.')
      return
    }
    setSending(true)
    setPendingAuthFlow({
      type: 'recovery',
      platform: isPlatform,
      organizationId: isPlatform ? '' : organizationId.trim().toLowerCase(),
    })
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: authCallbackUrl(),
    })
    setSending(false)
    if (resetError) {
      setError(
        resetError.status === 429
          ? 'Too many emails were requested. Wait a few minutes, then press Resend.'
          : resetError.message,
      )
      return
    }
    setLinkSent(true)
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="forgot-password-title">
        <div className="brand login-brand">
          <span className="brand-mark">M</span>
          <div><strong>MERCURY</strong><small>FM</small></div>
        </div>
        <div>
          <p className="eyebrow">Password recovery</p>
          <h1 id="forgot-password-title">Change password</h1>
        </div>
        {linkSent ? (
          <>
            <p role="status">
              A password-change link was sent to <strong>{email.trim()}</strong>. Open it to set a
              new password.
            </p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="button" className="primary-button" onClick={sendLink} disabled={sending}>
              {sending ? 'Sending...' : 'Resend link'}
            </button>
            <Link className="text-button" to={isPlatform ? '/platform-login' : '/login'}>
              Back to login
            </Link>
          </>
        ) : (
          <form onSubmit={sendLink} noValidate>
            {!isPlatform && (
              <>
                <label htmlFor="recovery-org">Organization ID</label>
                <input
                  id="recovery-org"
                  value={organizationId}
                  onChange={(event) => setOrganizationId(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                  autoComplete="organization"
                />
              </>
            )}
            <label htmlFor="recovery-email">Email</label>
            <input
              id="recovery-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={sending}>
              {sending ? 'Sending link...' : 'Send password-change link'}
            </button>
            <Link className="text-button" to={isPlatform ? '/platform-login' : '/login'}>
              Back to login
            </Link>
          </form>
        )}
      </section>
    </main>
  )
}