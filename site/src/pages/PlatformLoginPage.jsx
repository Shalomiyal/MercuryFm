import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import PasswordInput from '../components/ui/PasswordInput'

export default function PlatformLoginPage() {
  const { session, profile, loading, signIn, signOut } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && session && profile) {
      if (profile.role !== 'platform_admin') {
        signOut()
        setError('Invalid email or password.')
        return
      }
      if (profile.must_change_password) {
        navigate('/change-password', { replace: true })
      } else {
        navigate('/platform', { replace: true })
      }
    }
  }, [loading, session, profile, navigate, signOut])

  async function passwordLogin(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const { error: signInError } = await signIn(email.trim(), password)
    setSubmitting(false)
    if (signInError) setError('Invalid email or password.')
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="platform-login-title">
        <div className="brand login-brand">
          <span className="brand-mark">M</span>
          <div><strong>MERCURY</strong><small>FM</small></div>
        </div>
        <div>
          <p className="eyebrow">Platform access</p>
          <h1 id="platform-login-title">Platform sign in</h1>
        </div>
        <form onSubmit={passwordLogin} noValidate>
          <label htmlFor="platform-email">Email</label>
          <input id="platform-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <PasswordInput
            id="platform-password"
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Signing in...' : 'Sign in'}</button>
        </form>
        <Link className="text-button" to="/login">Organization login</Link>
      </section>
    </main>
  )
}
