import { randomBytes } from 'node:crypto'

// High-entropy, single-use password. The character mix satisfies common
// password policies without using any personal data such as a NIC number.
export function generateTemporaryPassword() {
  return `${randomBytes(24).toString('base64url')}A1!`
}
