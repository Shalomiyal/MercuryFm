import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import nodemailer from 'nodemailer'
import { adminClient } from './serverSupabase.js'
import { clientIp, consumeRateLimit } from './rateLimit.js'

export { clientIp } from './rateLimit.js'

export const CODE_TTL_MS = 10 * 60 * 1000
export const RESEND_COOLDOWN_MS = 60 * 1000
export const MAX_ATTEMPTS = 5

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function isValidEmail(value) {
  return EMAIL_RE.test(value) && value.length <= 254
}

export function hashCode(code) {
  return createHash('sha256').update(String(code)).digest('hex')
}

function hashesEqual(left, right) {
  const a = Buffer.from(left || '', 'hex')
  const b = Buffer.from(right || '', 'hex')
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

// Shared, database-backed limiter with a local fallback before the migration
// is applied. Returns { limited, retryAfter } so handlers can set Retry-After.
export async function rateLimit(key, limit, windowMs) {
  return consumeRateLimit(key, limit, windowMs)
}

// TODO: remove this in-memory fallback once every environment has run
// supabase/email-verification.sql. Production must use the database table so
// codes survive restarts and work across serverless instances.
const memoryCodes = (globalThis.__mercuryEmailCodes ||= new Map())
let storeMode = null

async function getStoreMode() {
  if (storeMode) return storeMode
  const { error } = await adminClient()
    .from('email_verification_codes')
    .select('email')
    .limit(1)
  if (error?.code === 'PGRST205' || error?.code === '42P01') {
    storeMode = 'memory'
    console.warn(
      '[email-verification] public.email_verification_codes is missing; using an in-memory store. ' +
        'Run supabase/email-verification.sql.',
    )
  } else if (error) {
    throw error
  } else {
    storeMode = 'db'
  }
  return storeMode
}

async function readCode(email) {
  if ((await getStoreMode()) === 'memory') return memoryCodes.get(email) || null
  const { data, error } = await adminClient()
    .from('email_verification_codes')
    .select('email, code_hash, expires_at, attempts, last_sent_at, user_id')
    .eq('email', email)
    .maybeSingle()
  if (error) throw error
  return data
}

async function writeCode(record) {
  if ((await getStoreMode()) === 'memory') {
    memoryCodes.set(record.email, record)
    return
  }
  const { error } = await adminClient()
    .from('email_verification_codes')
    .upsert(record, { onConflict: 'email' })
  if (error) throw error
}

async function deleteCode(email) {
  if ((await getStoreMode()) === 'memory') {
    memoryCodes.delete(email)
    return
  }
  const { error } = await adminClient()
    .from('email_verification_codes')
    .delete()
    .eq('email', email)
  if (error) throw error
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function smtpConfig() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  return {
    host,
    port,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    auth: { user, pass },
  }
}

async function sendCodeEmail({ email, code, fullName }) {
  const config = smtpConfig()
  // Local testing without SMTP: Nodemailer renders the message to JSON and we
  // log it to the server console. This is disabled in production.
  if (!config && process.env.NODE_ENV === 'production') {
    throw new Error('Email delivery is not configured')
  }
  const greeting = fullName ? `Hi ${escapeHtml(fullName)},` : 'Hi,'
  const transporter = config
    ? nodemailer.createTransport(config)
    : nodemailer.createTransport({ jsonTransport: true })
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || `"Mercury FM" <${config?.auth.user || 'no-reply@localhost'}>`,
    to: email,
    subject: 'Your Mercury FM verification code',
    text: [
      greeting,
      '',
      `Your verification code is ${code}.`,
      'It expires in 10 minutes and can only be used once.',
      '',
      'If you did not request this code, you can ignore this email.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <body style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
    <h2>Mercury FM email verification</h2>
    <p>${greeting}</p>
    <p>Enter this 6-digit code in the app to verify your email:</p>
    <p style="font-size: 32px; letter-spacing: 8px; font-weight: bold; margin: 20px 0;">${code}</p>
    <p><strong>This code expires in 10 minutes</strong> and can only be used once.</p>
    <p>If you did not request this code, you can ignore this email.</p>
  </body>
</html>`,
  })
  if (!config) {
    console.warn('[DEV ONLY - SMTP not configured] verification email was not sent:\n', info.message)
    return false
  }
  return true
}

// A signed-in user can ask for another code after the first one was consumed.
// Only accept the supplied id when it really belongs to this email address.
async function resolveUserId(email, userId) {
  if (!userId) return null
  const { data, error } = await adminClient().auth.admin.getUserById(userId)
  if (error || !data?.user) return null
  return normalizeEmail(data.user.email) === email ? userId : null
}

// Stores only a SHA-256 hash of the code. The plain code exists only in the
// email that is sent to the user.
export async function issueCode({ email, fullName, userId }) {
  const existing = await readCode(email)
  const elapsed = existing ? Date.now() - Date.parse(existing.last_sent_at) : RESEND_COOLDOWN_MS
  if (elapsed < RESEND_COOLDOWN_MS) {
    return {
      cooldown: true,
      retryAfter: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000),
    }
  }

  const code = String(randomInt(0, 1000000)).padStart(6, '0')
  const record = {
    email,
    code_hash: hashCode(code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    attempts: 0,
    last_sent_at: new Date().toISOString(),
    user_id: (await resolveUserId(email, userId)) || existing?.user_id || null,
  }
  await writeCode(record)
  let delivered = false
  try {
    delivered = await sendCodeEmail({ email, code, fullName })
  } catch (error) {
    await deleteCode(email).catch(() => {})
    throw error
  }
  return { cooldown: false, expiresIn: CODE_TTL_MS / 1000, delivered }
}

async function setAttempts(email, attempts) {
  if ((await getStoreMode()) === 'memory') {
    const record = memoryCodes.get(email)
    if (record) memoryCodes.set(email, { ...record, attempts })
    return
  }
  const { error } = await adminClient()
    .from('email_verification_codes')
    .update({ attempts })
    .eq('email', email)
  if (error) throw error
}

async function markVerified(userId) {
  if (!userId) return
  if ((await getStoreMode()) === 'memory') {
    console.warn(
      '[email-verification] in-memory mode: cannot persist email_verified for ' + userId,
    )
    return
  }
  const { error } = await adminClient()
    .from('profiles')
    .update({ email_verified: true })
    .eq('id', userId)
  if (error) throw error
}

export async function verifyCode({ email, code }) {
  const record = await readCode(email)
  if (!record) {
    return {
      status: 400,
      code: 'no_code',
      error: 'No verification code was requested. Send one first.',
    }
  }
  if (!record.expires_at || Date.now() > Date.parse(record.expires_at)) {
    await deleteCode(email)
    return {
      status: 400,
      code: 'expired',
      error: 'This code has expired. Request a new one.',
    }
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    return {
      status: 429,
      code: 'too_many_attempts',
      error: 'Too many attempts. Request a new code.',
    }
  }
  if (!hashesEqual(record.code_hash, hashCode(code))) {
    const attempts = (record.attempts || 0) + 1
    await setAttempts(email, attempts)
    if (attempts >= MAX_ATTEMPTS) {
      return {
        status: 429,
        code: 'too_many_attempts',
        error: 'Too many attempts. Request a new code.',
      }
    }
    return {
      status: 400,
      code: 'invalid_code',
      error: `Invalid code. ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts === 1 ? '' : 's'} remaining.`,
    }
  }

  // Single use: remove the code as soon as it matches.
  await deleteCode(email)
  if (record.user_id) await markVerified(record.user_id)
  return { status: 200, code: 'verified', error: null }
}
