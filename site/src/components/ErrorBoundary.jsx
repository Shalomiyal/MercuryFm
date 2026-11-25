import { Component } from 'react'

function report(error, info) {
  console.error('Unhandled UI error:', error, info)
  // Optional Sentry integration: if a host app has already installed Sentry,
  // use it without adding a hard dependency to this bundle.
  const capture = window.Sentry?.captureException || window.__mercuryCaptureError
  if (typeof capture === 'function') capture(error, { context: info })
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    report(error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="login-page">
        <section className="login-card" role="alert">
          <div>
            <p className="eyebrow">Something went wrong</p>
            <h1>We could not load this page</h1>
          </div>
          <p className="upload-help">
            Your work is safe. Try reloading the page, or sign out and back in.
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </section>
      </main>
    )
  }
}
