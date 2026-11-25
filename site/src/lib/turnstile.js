const SITE_KEY = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim()
let scriptPromise = null

export function turnstileEnabled() {
  return Boolean(SITE_KEY)
}

function loadScript() {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => resolve(window.turnstile)
    script.onerror = () => reject(new Error('Turnstile could not load'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

// Returns a single-use token. Call immediately before the API request that
// needs it. When no site key is configured this resolves to null and callers
// omit the field entirely.
export async function getTurnstileToken() {
  if (!turnstileEnabled()) return null
  const turnstile = await loadScript()
  return new Promise((resolve) => {
    const container = document.createElement('div')
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    document.body.appendChild(container)
    let settled = false
    let widgetId = null
    const finish = (token) => {
      if (settled) return
      settled = true
      try {
        if (widgetId !== null) turnstile.remove(widgetId)
      } catch {
        /* already expired */
      }
      container.remove()
      resolve(token)
    }
    widgetId = turnstile.render(container, {
      sitekey: SITE_KEY,
      size: 'invisible',
      appearance: 'interaction-only',
      callback: finish,
      'error-callback': () => finish(null),
      'expired-callback': () => finish(null),
    })
    setTimeout(() => finish(null), 30000)
  })
}
