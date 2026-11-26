import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiPost } from '../lib/api'
import { getTurnstileToken } from '../lib/turnstile'

export default function SignupPage() {
  const navigate = useNavigate()
  const [organizationId, setOrganizationId] = useState('')
  const [fullName, setFullName] = useState('')
  const [nic, setNic] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  async function signup(event) {
    event.preventDefault()
    setError('')
    const slug = organizationId.trim().toLowerCase()
    if (!/^[a-z0-9_]{2,30}$/.test(slug)) {
      setError('Enter a valid organization ID.')
      return
    }
    if (!fullName.trim()) {
      setError('Enter your full name.')
      return
    }
    const normalizedNic = nic.trim().toUpperCase()
    if (!/^(?:\d{9}[VX]|\d{12})$/.test(normalizedNic)) {
      setError('Enter a valid NIC: 9 digits followed by V/X or 12 digits.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    setSending(true)
    try {
      const turnstileToken = await getTurnstileToken()
      await apiPost('/start-signup', {
        turnstileToken,
        organizationId: slug,
        fullName: fullName.trim(),
        nic: normalizedNic,
        phone: phone.trim(),
        email: email.trim(),
      })
      navigate('/login', {
        replace: true,
        state: {
          message: 'Account created. Sign in with your email and NIC as your password. You can change it after logging in.',
        },
      })
    } catch (requestError) {
      setError(requestError.message || 'Could not create the account. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="signup-title">
        <div className="brand login-brand">
          <span className="brand-mark">M</span>
          <div><strong>MERCURY</strong><small>FM</small></div>
        </div>
        <div>
          <p className="eyebrow">Create account</p>
          <h1 id="signup-title">Sign up</h1>
        </div>
        <form onSubmit={signup} noValidate>
          <label htmlFor="signup-org">Organization ID</label>
          <input
            id="signup-org"
            value={organizationId}
            onChange={(event) =>
              setOrganizationId(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
            }
            placeholder="Organization slug"
            autoComplete="organization"
          />
          <label htmlFor="signup-name">Full name</label>
          <input
            id="signup-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
          />
          <label htmlFor="signup-nic">NIC number</label>
          <input
            id="signup-nic"
            value={nic}
            onChange={(event) => setNic(event.target.value.toUpperCase().replace(/[^0-9VX]/g, '').slice(0, 12))}
            placeholder="NIC number"
            autoComplete="off"
          />
          <p className="upload-help">Your NIC is stored as identity data only. A temporary password will be shown once after signup.</p>
          <label htmlFor="signup-phone">Phone (optional)</label>
          <input
            id="signup-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
          />
          <label htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={sending}>
            {sending ? 'Creating account...' : 'Send verification code'}
          </button>
          <Link className="text-button" to="/login">Back to login</Link>
        </form>
      </section>
    </main>
  )
}
