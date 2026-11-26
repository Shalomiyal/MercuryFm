import { describe, expect, it, vi } from 'vitest'
import { jsonError } from '../server/lib/httpError'

function fakeResponse() {
  const response = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value
      return this
    },
    status(code) {
      this.statusCode = code
      return this
    },
    send(body) {
      this.body = body
      return this
    },
  }
  vi.spyOn(response, 'setHeader')
  vi.spyOn(response, 'status')
  vi.spyOn(response, 'send')
  return response
}

describe('jsonError', () => {
  it('writes JSON with a generic message and a stable code', () => {
    const response = fakeResponse()
    jsonError(response, 410, { error: 'Gone', code: 'INVITE_DISABLED' })
    expect(response.headers['Content-Type']).toBe('application/json')
    expect(response.statusCode).toBe(410)
    expect(response.body).toEqual({ error: 'Gone', code: 'INVITE_DISABLED' })
  })

  it('omits null optional fields', () => {
    const response = fakeResponse()
    jsonError(response, 400, { error: 'Bad request', retryAfter: null })
    expect(response.body).toEqual({ error: 'Bad request' })
  })
})
