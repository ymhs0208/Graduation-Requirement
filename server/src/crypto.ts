import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { hash, verify } from '@node-rs/argon2'
import { Secret, TOTP } from 'otpauth'
import { env } from './env'

export async function hashPassword(password: string) {
  return hash(password, {
    algorithm: 2,
    memoryCost: env.argonMemory,
    timeCost: env.argonTime,
    parallelism: 1,
  })
}

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

export function passwordIssues(password: string, account: string) {
  const issues: string[] = []
  if (password.length < 12) issues.push('length')
  if (!/[a-z]/.test(password)) issues.push('lower')
  if (!/[A-Z]/.test(password)) issues.push('upper')
  if (!/[0-9]/.test(password)) issues.push('digit')
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('symbol')
  if (account && password.toLowerCase().includes(account.toLowerCase())) issues.push('account')
  return issues
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function tempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const pick = (n: number) =>
    Array.from(randomBytes(n))
      .map((b) => alphabet[b % alphabet.length])
      .join('')
  return `Aa1!${pick(12)}`
}

function totpFor(secret: string, account = 'gradtrack') {
  return new TOTP({
    issuer: 'NUTC-AI',
    label: account,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  })
}

export function newTotpSecret() {
  return new Secret({ size: 20 }).base32
}

export function verifyTotp(secret: string, token: string) {
  const cleaned = token.replace(/\s/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false
  const delta = totpFor(secret).validate({ token: cleaned, window: 1 })
  return delta !== null
}

export function currentTotp(secret: string) {
  return totpFor(secret).generate()
}

export function totpUri(secret: string, account: string) {
  return totpFor(secret, account).toString()
}
