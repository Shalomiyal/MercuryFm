import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { clearPendingAuthFlow, getPendingAuthFlow } from '../lib/authFlow'
import PasswordInput from '../components/ui/PasswordInput'

export default function ResetPasswordPage() {
  const { session, profile, loading, signOut } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(true)
  const [blocked, setBlocked] = useState('')
  const [isPlatform, setIsPlatform] = useState(false)
  const validated = useRef(false)

  useEffect(() => {
    if (loading || validated.current) return
    const flow = getPendingAuthFlow()
    const needsOrgCheck = Boolean(
      flow && flow.type === 'recovery' && !flow.platform,
    )
    if (!session) {
      validated.current = true
      clearPendingAuthFlow()
      setChecking(false)
      setBlocked('This link is invalid or has expired. Request a new link.')
      return
    }
    if (needsOrgCheck && !profile) return
    validated.current = true
    clearPendingAuthFlow()
    setIsPlatform(Boolean(flow?.platform))
    if (!needsOrgCheck) {
      setChecking(false)
      return
    }
    const slug = String(flow.organizationId || '').toLowerCase()
    if (!slug || !profile?.org_id) {
      setChecking(false)
      setBlocked('Invalid organization, email or link.')
      return
    }
    supabase
      .from('organizations')
      .select('id, is_active')
      .eq('slug', slug)
      .maybeSingle()
      .then(async ({ data: organization }) => {
        if (!organization?.is_active || organization.id !== profile.org_id) {
          await supabase.auth.signOut()
          setBlocked('Invalid organization, email or link.')
        }
        setChecking(false)
      })
  }, [loading, session, profile])

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setSaving(false)
      setError(updateError.message)
      return
    }
    const { data: sessionData } = await supabase.auth.getSession()
    const userId = sessionData.session?.user.id
    if (userId) {
      await supabase
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', userId)
    }
    setSaving(false)
    navigate(isPlatform ? '/platform-login' : '/login', { replace: true })
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="reset-password-title">
        <div>
          <p className="eyebrow">Password recovery</p>
          <h1 id="reset-password-title">Set new password</h1>
        </div>
        {checking ? (
          <p role="status">Checking your link...</p>
        ) : blocked ? (
          <>
            <p className="form-error" role="alert">{blocked}</p>
            <button
              type="button"
              className="primary-button"
              onClick={async () => {
                await signOut()
                navigate('/login', { replace: true })
              }}
            >
              Back to login
            </button>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <PasswordInput
              id="reset-password"
              label="New password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <PasswordInput
              id="reset-confirm-password"
              label="Confirm password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Set password'}</button>
            <Link className="text-button" to={isPlatform ? '/platform-login' : '/login'}>
              Back to login
            </Link>
          </form>
        )}
      </section>
    </main>
  )
}