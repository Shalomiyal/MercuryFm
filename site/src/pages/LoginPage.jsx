import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import BrandLogo from '../components/ui/BrandLogo'
import PasswordInput from '../components/ui/PasswordInput'

export default function LoginPage() {
  const { session, profile, loading, signIn, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [organizationId, setOrganizationId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && session && profile) {
      if (profile.email_verified === false) {
        navigate('/verify-email', {
          replace: true,
          state: { email: session.user.email },
        })
        return
      }
      if (profile.must_change_password) {
        navigate('/change-password', { replace: true })
        return
      }
      const destination = profile.role === 'platform_admin'
        ? '/platform'
        : profile.role === 'cleaner'
          ? '/cleaner/tasks'
          : '/admin'
      navigate(destination, { replace: true, state: location.state })
    }
  }, [loading, session, profile, navigate, location.state])

  async function submit(event) {
    event.preventDefault()
    setError('')
    const slug = organizationId.trim().toLowerCase()
    if (!slug || !email.trim() || !password) {
      setError('Invalid organization, email or password.')
      return
    }
    if (!/^[a-z0-9_]{2,30}$/.test(slug)) {
      setError('Invalid organization, email or password.')
      return
    }
    setSubmitting(true)
    const { error: signInError } = await signIn(email.trim(), password)
    if (signInError) {
      setSubmitting(false)
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Invalid email or password. Use the temporary password from your invitation.'
          : 'Sign in failed. Check your details and try again.',
      )
      return
    }

    const { data: authData } = await supabase.auth.getSession()
    const userId = authData.session?.user.id
    if (!userId) {
      await signOut()
      setSubmitting(false)
      setError('Invalid organization, email or password.')
      return
    }
    const [{ data: profileRow, error: profileError }, { data: organization, error: organizationError }] =
      await Promise.all([
        supabase
          .from('profiles')
          .select('id, role, org_id, email_verified')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('organizations')
          .select('id, slug, is_active')
          .eq('slug', slug)
          .maybeSingle(),
      ])
    if (
      profileError ||
      organizationError ||
      !profileRow ||
      !organization ||
      !organization.is_active ||
      profileRow.org_id !== organization.id
    ) {
      await signOut()
      setSubmitting(false)
      setError('Invalid organization, email or password.')
      return
    }
    if (profileRow.email_verified === false) {
      await signOut()
      setSubmitting(false)
      navigate('/verify-email', { replace: true, state: { email: email.trim() } })
      return
    }
    setSubmitting(false)
  }

  async function forgotPassword() {
    setError('')
    if (!organizationId.trim() || !email.trim()) {
      setError('Enter your Organization ID and email.')
      return
    }
    navigate('/forgot-password', {
      state: { organizationId: organizationId.trim(), email: email.trim() },
    })
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div>
          <BrandLogo subtitle="Workforce & Operations" />
          <p className="eyebrow" style={{ marginTop: 14 }}>Organization login</p>
          <h1 id="login-title">Sign in</h1>
        </div>
        <form onSubmit={submit} noValidate>
          <label htmlFor="organization-id">Organization ID</label>
          <input
            id="organization-id"
            type="text"
            value={organizationId}
            onChange={(event) =>
              setOrganizationId(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
            }
            placeholder="Organization slug"
            autoComplete="organization"
            required
            aria-required="true"
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'login-error' : undefined}
          />
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            autoComplete="email"
            required
            aria-required="true"
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'login-error' : undefined}
          />
          <PasswordInput
            id="password"
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
            aria-required="true"
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'login-error' : 'login-password-help'}
          />
          <p id="login-password-help" className="upload-help">
            First login: use the temporary password shown when your account was created. You will be asked to change it.
          </p>
          {location.state?.notice && (
            <p className="organization-found" role="status">{location.state.notice}</p>
          )}
          {error && <p id="login-error" className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
          <button type="button" className="text-button" onClick={forgotPassword}>Forgot password?</button>
          <p className="signup-row">
            Don&apos;t have an account? <Link to="/signup">Sign up</Link>
          </p>
        </form>
      </section>
    </main>
  )
}
