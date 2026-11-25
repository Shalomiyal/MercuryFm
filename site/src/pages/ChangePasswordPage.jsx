import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { homeForRole } from '../lib/authFlow'
import PasswordInput from '../components/ui/PasswordInput'

export default function ChangePasswordPage() {
  const { profile, setProfile, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

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
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData?.session?.access_token
    if (accessToken) {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ newPassword: password }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setSaving(false)
        setError(body.error || 'Password could not be changed. Please try again.')
        return
      }
    } else {
      // Fallback for standalone local sessions where the API shim is absent.
      const { error: authError } = await supabase.auth.updateUser({ password })
      if (authError) {
        setSaving(false)
        setError('Password could not be changed. Try a different password.')
        return
      }
      const { error: stateError } = await supabase.rpc('mark_password_changed')
      if (stateError) {
        setSaving(false)
        setError('Password was changed but the account state could not be refreshed.')
        return
      }
    }

    // The page was entered because the cached profile said a change was due.
    // Reload it before redirecting, otherwise ProtectedRoute sees the old flag
    // and bounces the user back here forever.
    if (setProfile) {
      setProfile((prev) => (prev ? { ...prev, must_change_password: false } : null))
    }
    const freshProfile = await refreshProfile()
    setSaving(false)
    navigate(homeForRole(freshProfile?.role || profile?.role || 'cleaner'), {
      replace: true,
    })
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="change-password-title">
        <div>
          <p className="eyebrow">First login</p>
          <h1 id="change-password-title">Change password</h1>
        </div>
        <form onSubmit={submit} noValidate>
          <PasswordInput
            id="new-password"
            label="New password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
          <PasswordInput
            id="confirm-password"
            label="Confirm password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Change password'}</button>
          <button type="button" className="text-button" onClick={signOut}>Sign out</button>
        </form>
      </section>
    </main>
  )
}
