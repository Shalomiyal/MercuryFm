import { describe, expect, it } from 'vitest'
import {
  formatDateTime,
  formatRelative,
  formatTime,
  friendlyError,
} from '../src/lib/format'

describe('friendlyError', () => {
  it('maps network failures to an actionable message', () => {
    expect(friendlyError(new Error('Failed to fetch'))).toMatch(/connection/i)
  })

  it('maps expired sessions to a sign-in prompt', () => {
    expect(friendlyError(new Error('JWT expired'))).toMatch(/sign in again/i)
  })

  it('maps permission failures to an access message', () => {
    expect(friendlyError(new Error('permission denied by RLS'))).toMatch(/do not have access/i)
  })

  it('keeps a safe generic message when there is no error', () => {
    expect(friendlyError(null)).toBe('Something went wrong. Please try again.')
  })

  it('passes through a plain application message', () => {
    expect(friendlyError(new Error('Invite code already used'))).toBe('Invite code already used')
  })
})

describe('date and time formatting', () => {
  it('uses 12-hour time with an AM/PM marker', () => {
    const date = new Date(2026, 0, 2, 15, 4)
    expect(formatDateTime(date)).toMatch(/3:04 PM/)
    expect(formatTime(date)).toMatch(/3:04 PM/)
  })

  it('handles missing and invalid values without throwing', () => {
    expect(formatDateTime(null)).toBe('Not set')
    expect(formatTime('not-a-date')).toBe('Not set')
  })

  it('formats relative timestamps', () => {
    const now = new Date('2026-01-02T12:00:00Z').getTime()
    expect(formatRelative(now - 5000, now)).toBe('just now')
    expect(formatRelative(now - 120000, now)).toBe('2 minutes ago')
    expect(formatRelative('invalid', now)).toBe('just now')
  })
})
