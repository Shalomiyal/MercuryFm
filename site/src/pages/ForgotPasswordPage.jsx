import { useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { authCallbackUrl, setPendingAuthFlow } from '../lib/authFlow'
import { apiPost } from '../lib/api'

export default function ForgotPasswordPage() {
  const location = useLocation()
  const [email, setEmail] = useState(location.state?.email || '')
  const [organizationId, setOrganizationId] = useState(location.state?.organizationId || '')
  const [isPlatform, setIsPlatform] = useState(Boolean(location.state?.platform))
  const [mode, setMode] = useState('email') // 'email' | 'nic'
  const [nic, setNic] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [nicReset, setNicReset] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    setIsPlatform(Boolean(location.state?.platform))
  }, [location.state])

  async function sendLink(event) {
    event.preventDefault()
    setError('')
    if (!email.trim()) { setError('Enter your email.'); return }
    if (!isPlatform && !organizationId.trim()) { setError('Enter your Organization ID.'); return }
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

  async function resetWithNic(event) {
    event.preventDefault()
    setError('')
    if (!organizationId.trim()) { setError('Enter your Organization ID.'); return }
    if (!email.trim()) { setError('Enter your email.'); return }
    const normalizedNic = nic.trim().toUpperCase()
    if (!/^(?:\d{9}[VX]|\d{12})$/.test(normalizedNic)) {
      setError('Enter a valid NIC: 9 digits followed by V/X, or 12 digits.')
      return
    }
    setSending(true)
    try {
      await apiPost('/reset-with-nic', {
        organizationId: organizationId.trim().toLowerCase(),
        email: email.trim(),
        nic: normalizedNic,
      })
      setNicReset(true)
    } catch (err) {
      setError(err.message || 'Could not reset password. Please contact your administrator.')
    } finally {
      setSending(false)
    }
  }

  const backTo = isPlatform ? '/platform-login' : '/login'

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="forgot-password-title">
        <div className="brand login-brand">
          <span className="brand-mark">M</span>
          <div><strong>MERCURY</strong><small>FM</small></div>
        </div>
        <div>
          <p className="eyebrow">Password recovery</p>
          <h1 id="forgot-password-title">Reset password</h1>
        </div>

        {nicReset ? (
          <>
            <div className="notice success" role="status">
              Password reset to your NIC. You can now sign in using your NIC as your password.
            </div>
            <Link className="primary-button" style={{ textAlign: 'center' }} to={backTo}>
              Back to login
            </Link>
          </>
        ) : linkSent ? (
          <>
            <p role="status">
              A password-change link was sent to <strong>{email.trim()}</strong>. Open it to set a
              new password.
            </p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="button" className="primary-button" onClick={sendLink} disabled={sending}>
              {sending ? 'Sending...' : 'Resend link'}
            </button>
            <Link className="text-button" to={backTo}>Back to login</Link>
          </>
        ) : (
          <>
            {!isPlatform && (
              <div className="task-filter" style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  className={mode === 'nic' ? 'active' : ''}
                  onClick={() => setMode('nic')}
                >
                  Reset with NIC
                </button>
                <button
                  type="button"
                  className={mode === 'email' ? 'active' : ''}
                  onClick={() => setMode('email')}
                >
                  Reset by email link
                </button>
              </div>
            )}

            {mode === 'nic' && !isPlatform ? (
              <form onSubmit={resetWithNic} noValidate>
                <label htmlFor="recovery-org">Organization ID</label>
                <input
                  id="recovery-org"
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                  autoComplete="organization"
                  placeholder="Your organization slug"
                />
                <label htmlFor="recovery-email">Email</label>
                <input
                  id="recovery-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
                <label htmlFor="recovery-nic">NIC number</label>
                <input
                  id="recovery-nic"
                  value={nic}
                  onChange={(e) => setNic(e.target.value.toUpperCase().replace(/[^0-9VX]/g, '').slice(0, 12))}
                  placeholder="Your NIC number"
                  autoComplete="off"
                />
                <p className="field-hint">Your password will be reset back to your NIC number.</p>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="primary-button" type="submit" disabled={sending}>
                  {sending ? 'Resetting...' : 'Reset password with NIC'}
                </button>
                <Link className="text-button" to={backTo}>Back to login</Link>
              </form>
            ) : (
              <form onSubmit={sendLink} noValidate>
                {!isPlatform && (
                  <>
                    <label htmlFor="recovery-org2">Organization ID</label>
                    <input
                      id="recovery-org2"
                      value={organizationId}
                      onChange={(e) => setOrganizationId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                      autoComplete="organization"
                    />
                  </>
                )}
                <label htmlFor="recovery-email2">Email</label>
                <input
                  id="recovery-email2"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="primary-button" type="submit" disabled={sending}>
                  {sending ? 'Sending link...' : 'Send password-change link'}
                </button>
                <Link className="text-button" to={backTo}>Back to login</Link>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  )
}
