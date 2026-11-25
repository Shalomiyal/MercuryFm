import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { homeForRole } from '../lib/authFlow'

export default function NotFoundPage() {
  const { session, profile } = useAuth()
  const destination = session && profile ? homeForRole(profile.role) : '/login'

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="not-found-title">
        <div>
          <p className="eyebrow">404</p>
          <h1 id="not-found-title">Page not found</h1>
        </div>
        <p className="upload-help">
          The page you were looking for does not exist or has moved.
        </p>
        <Link className="primary-button" to={destination}>Go to your dashboard</Link>
      </section>
    </main>
  )
}
