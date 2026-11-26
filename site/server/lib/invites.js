import { createHash, randomBytes, randomInt } from 'node:crypto'

// Invite codes are short enough to type but random enough to resist guessing.
export function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('')
}

export function hashInviteCode(code) {
  return createHash('sha256').update(String(code || '').trim().toUpperCase()).digest('hex')
}

export function normalizeInviteCode(code) {
  return String(code || '').trim().toUpperCase()
}

export function generateInviteId() {
  return randomBytes(16).toString('hex')
}
