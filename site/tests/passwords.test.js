import { describe, expect, it } from 'vitest'
import { generateTemporaryPassword } from '../api/lib/passwords'

describe('generateTemporaryPassword', () => {
  it('returns a high-entropy password with policy characters', () => {
    const password = generateTemporaryPassword()
    expect(password.length).toBeGreaterThan(30)
    expect(password).toMatch(/A1!$/)
    expect(password).not.toMatch(/\s/)
  })

  it('never repeats a password', () => {
    const first = generateTemporaryPassword()
    const second = generateTemporaryPassword()
    expect(first).not.toBe(second)
  })
})
