import { logger } from './logger.js'

export async function withTimeout(fn, timeoutMs = 5000, label = 'operation') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeoutMs)
  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

export async function withRetry(fn, { retries = 2, baseDelayMs = 200, maxDelayMs = 2000 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (attempt === retries) break
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      const jitter = Math.floor(Math.random() * Math.max(25, exp * 0.3))
      await new Promise((resolve) => setTimeout(resolve, exp + jitter))
    }
  }
  throw lastError
}

export class CircuitBreaker {
  constructor(name, { failureThreshold = 5, resetTimeoutMs = 30000 } = {}) {
    this.name = name
    this.failureThreshold = failureThreshold
    this.resetTimeoutMs = resetTimeoutMs
    this.state = 'CLOSED'
    this.failures = 0
    this.openedAt = 0
  }

  async exec(fn, fallback) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN'
      } else {
        logger.warn('circuit_open_short_circuit', { breaker: this.name })
        if (fallback) return fallback(new Error(`Circuit ${this.name} is OPEN`))
        throw new Error(`Service ${this.name} temporarily unavailable`)
      }
    }

    try {
      const result = await fn()
      this.failures = 0
      if (this.state !== 'CLOSED') {
        this.state = 'CLOSED'
        logger.info('circuit_closed', { breaker: this.name })
      }
      return result
    } catch (error) {
      this.failures += 1
      if (this.failures >= this.failureThreshold || this.state === 'HALF_OPEN') {
        this.state = 'OPEN'
        this.openedAt = Date.now()
        logger.error('circuit_opened', { breaker: this.name, failures: this.failures })
      }
      if (fallback) return fallback(error)
      throw error
    }
  }
}
