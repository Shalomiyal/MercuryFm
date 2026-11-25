import { useLocation, useNavigate } from 'react-router-dom'
import VerifyEmail from '../components/VerifyEmail'
import { useAuth } from '../contexts/AuthContext'
import { homeForRole } from '../lib/authFlow'

export default function VerifyEmailPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { session, profile, refreshProfile } = useAuth()
  const email = location.state?.email || session?.user?.email || ''
  const fullName = location.state?.fullName || profile?.full_name || ''

  async function continueAfterVerification() {
    // Verification happens on the server. Refresh before deciding where to go,
    // otherwise the stale login-time profile keeps sending the user backwards.
    const freshProfile = session ? await refreshProfile() : null

    if (!session) {
      navigate('/login', {
        replace: true,
        state: {
          notice: 'Email verified. You can sign in now.',
        },
      })
      return
    }
    if (freshProfile?.must_change_password) {
      navigate('/change-password', { replace: true })
      return
    }
    navigate(homeForRole(freshProfile?.role || profile?.role || 'cleaner'), {
      replace: true,
    })
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="verify-email-title">
        <div>
          <p className="eyebrow">First login</p>
          <h1 id="verify-email-title">Verify email</h1>
        </div>
        <VerifyEmail
          email={email}
          fullName={fullName}
          codeSent={location.state?.codeSent}
          delivered={location.state?.delivered}
          tempPassword={location.state?.tempPassword}
          signInNotice={!session}
          onVerified={continueAfterVerification}
        />
      </section>
    </main>
  )
}
