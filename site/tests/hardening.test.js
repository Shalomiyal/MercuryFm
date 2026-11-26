import { describe, expect, it, vi } from 'vitest'
import { validateBody } from '../server/lib/validate'
import { CircuitBreaker, withRetry } from '../server/lib/resilience'
import { cacheDelete, cacheGet, cacheSet } from '../server/lib/cache'
import { sendRateLimited } from '../server/lib/rateLimit'
import { applyCors } from '../server/lib/cors'
import healthHandler from '../server/handlers/health'

function mockResponse() {
  const headers = {}
  let statusCode = 200
  let sentBody = null
  return {
    headers,
    get statusCode() {
      return statusCode
    },
    get body() {
      return sentBody
    },
    setHeader(k, v) {
      headers[k.toLowerCase()] = v
    },
    status(code) {
      statusCode = code
      return this
    },
    send(payload) {
      sentBody = payload
      return this
    },
  }
}

describe('production hardening helpers', () => {
  it('validates and sanitizes JSON input', () => {
    const res = validateBody(
      { email: '  USER@Example.com ', role: 'cleaner', hours: '24' },
      {
        email: { type: 'string', required: true, lowercase: true },
        role: { type: 'string', enum: ['admin', 'cleaner'] },
        hours: { type: 'number', min: 1, max: 720 },
      },
    )
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ email: 'user@example.com', role: 'cleaner', hours: 24 })

    const bad = validateBody({ role: 'superadmin' }, { role: { type: 'string', enum: ['admin', 'cleaner'] } })
    expect(bad.ok).toBe(false)
  })

  it('sets Retry-After header on 429 responses', () => {
    const res = mockResponse()
    sendRateLimited(res, 42, { code: 'rate_limited', error: 'Slow down' })
    expect(res.statusCode).toBe(429)
    expect(res.headers['retry-after']).toBe('42')
    expect(res.body).toEqual({ code: 'rate_limited', error: 'Slow down', retryAfter: 42 })
  })

  it('caches and invalidates values in memory', async () => {
    await cacheSet('org:demo', { id: '1', slug: 'demo' }, 60)
    expect(await cacheGet('org:demo')).toEqual({ id: '1', slug: 'demo' })
    await cacheDelete('org:demo')
    expect(await cacheGet('org:demo')).toBeNull()
  })

  it('opens circuit breaker after threshold and uses fallback', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 2, resetTimeoutMs: 5000 })
    const fail = () => Promise.reject(new Error('down'))
    await expect(breaker.exec(fail)).rejects.toThrow('down')
    await expect(breaker.exec(fail)).rejects.toThrow('down')
    expect(breaker.state).toBe('OPEN')

    const spy = vi.fn(() => Promise.resolve('ok'))
    const fallbackResult = await breaker.exec(spy, () => 'fallback')
    expect(fallbackResult).toBe('fallback')
    expect(spy).not.toHaveBeenCalled()
  })

  it('retries transient failures with backoff', async () => {
    let calls = 0
    const result = await withRetry(
      () => {
        calls += 1
        if (calls < 2) throw new Error('transient')
        return 'ok'
      },
      { retries: 2, baseDelayMs: 5, maxDelayMs: 10 },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(2)
  })

  it('enforces strict CORS allowlist without wildcard', () => {
    process.env.APP_ORIGIN = 'https://app.mercuryfm.example'
    const okRes = mockResponse()
    const handled = applyCors(
      { method: 'OPTIONS', headers: { origin: 'https://app.mercuryfm.example' } },
      okRes,
    )
    expect(handled).toBe(true)
    expect(okRes.statusCode).toBe(204)
    expect(okRes.headers['access-control-allow-origin']).toBe('https://app.mercuryfm.example')

    const badRes = mockResponse()
    applyCors({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } }, badRes)
    expect(badRes.statusCode).toBe(403)
    expect(badRes.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('returns 200 no-store from /api/health', () => {
    const res = mockResponse()
    healthHandler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body.status).toBe('ok')
  })
})
