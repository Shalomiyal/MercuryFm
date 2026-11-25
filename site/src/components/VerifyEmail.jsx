import { useEffect, useRef, useState } from 'react'
import { apiPost } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { getTurnstileToken } from '../lib/turnstile'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function errorMessage(error) {
  if (error.code === 'cooldown') {
    return `Please wait ${error.retryAfter || 60} seconds before requesting another code.`
  }
  if (error.code === 'rate_limited') {
    return 'Too many requests. Please wait a few minutes and try again.'
  }
  return error.message || 'Something went wrong. Please try again.'
}

export default function VerifyEmail({
  email: initialEmail = '',
  fullName = '',
  codeSent = false,
  delivered,
  tempPassword = '',
  signInNotice = false,
  onVerified,
}) {
  const { session } = useAuth()
  const [step, setStep] = useState(codeSent ? 'code' : 'email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(
    codeSent
      ? delivered === false
        ? 'Email delivery is not configured. No email was sent — in local development the code is printed in the Vite terminal instead.'
        : `We sent a 6-digit code to ${initialEmail}. It expires in 10 minutes.`
      : '',
  )
  const [retryAfter, setRetryAfter] = useState(codeSent ? 60 : 0)
  const [verified, setVerified] = useState(false)
  const inFlight = useRef(false)

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail)
  }, [initialEmail])

  useEffect(() => {
    if (!tempPassword) return
    const message = `Temporary password: ${tempPassword}. Save it now — it will not be shown again.`
    setNotice((current) => (current ? `${current} ${message}` : message))
  }, [tempPassword])

  useEffect(() => {
    if (!retryAfter) return undefined
    const timer = setInterval(() => {
      setRetryAfter((current) => (current > 1 ? current - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [retryAfter])

  async function requestCode(event) {
    event?.preventDefault()
    if (inFlight.current || retryAfter > 0) return
    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_RE.test(normalizedEmail)) {
      setError('Enter a valid email address.')
      return
    }
    setEmail(normalizedEmail)
    inFlight.current = true
    setSending(true)
    setError('')
    setNotice('')
    try {
      const turnstileToken = await getTurnstileToken()
      const result = await apiPost('/send-code', {
        email: normalizedEmail,
        fullName,
        userId: session?.user?.id,
        turnstileToken,
      })
      setStep('code')
      setCode('')
      setNotice(
        result?.delivered === false
          ? 'Email delivery is not configured. No email was sent — in local development the code is printed in the Vite terminal instead.'
          : `We sent a 6-digit code to ${normalizedEmail}. It expires in 10 minutes.`,
      )
    } catch (requestError) {
      setError(errorMessage(requestError))
      if (requestError.code === 'cooldown') {
        setRetryAfter(requestError.retryAfter || 60)
        setStep('code')
      }
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  async function submitCode(event) {
    event.preventDefault()
    if (inFlight.current) return
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code.')
      return
    }
    inFlight.current = true
    setVerifying(true)
    setError('')
    try {
      await apiPost('/verify-code', { email, code })
      setVerified(true)
      setNotice('')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      inFlight.current = false
      setVerifying(false)
    }
  }

  if (verified) {
    return (
      <div className="verify-email">
        <p className="organization-found" role="status">
          {signInNotice
            ? 'Your email is verified. You can sign in now.'
            : 'Your email is verified. You can continue.'}
        </p>
        {tempPassword && (
          <p className="organization-found" role="status">
            Temporary password: <strong>{tempPassword}</strong>. Store it securely — it will not be shown again.
          </p>
        )}
        <button type="button" className="primary-button" onClick={onVerified}>
          Continue
        </button>
      </div>
    )
  }

  return (
    <div className="verify-email">
      <p className="upload-help">
        We send a 6-digit verification code instead of a link. The code expires in 10 minutes.
      </p>

      {step === 'email' ? (
        <form onSubmit={requestCode} noValidate>
          <label htmlFor="verify-email-input">Email</label>
          <input
            id="verify-email-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          {notice && <p className="organization-found" role="status">{notice}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={sending}>
            {sending ? 'Sending...' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} noValidate>
          <label htmlFor="verify-code-input">6-digit code</label>
          <input
            id="verify-code-input"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            placeholder="000000"
          />
          {notice && <p className="organization-found" role="status">{notice}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={verifying}>
            {verifying ? 'Verifying...' : 'Verify code'}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={requestCode}
            disabled={sending || retryAfter > 0}
          >
            {retryAfter > 0
              ? `Resend code in ${retryAfter}s`
              : sending
                ? 'Sending...'
                : 'Resend code'}
          </button>
        </form>
      )}
    </div>
  )
}
