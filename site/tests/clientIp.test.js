import { beforeEach, describe, expect, it } from 'vitest'
import { clientIp } from '../api/lib/rateLimit'

function request(headers) {
  return { headers }
}

describe('clientIp', () => {
  beforeEach(() => {
    // The shared counter is not deployed in the test environment; these
    // assertions only cover header parsing, which has no external calls.
  })

  it('uses the rightmost forwarded address instead of a spoofed leftmost one', () => {
    expect(
      clientIp(request({ 'x-forwarded-for': '1.1.1.1, 10.0.0.4' })),
    ).toBe('10.0.0.4')
  })

  it('falls back to the Vercel header', () => {
    expect(clientIp(request({ 'x-vercel-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe(
      '203.0.113.9',
    )
  })

  it('falls back to x-real-ip and then to a local bucket', () => {
    expect(clientIp(request({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7')
    expect(clientIp(request({}))).toBe('local')
  })
})
