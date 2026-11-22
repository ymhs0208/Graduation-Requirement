import { Router } from 'express'
import type { Request } from 'express'
import rateLimit from 'express-rate-limit'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { z } from 'zod'
import { audit } from '../audit'
import { verifyTotp } from '../crypto'
import { prisma } from '../db'
import { env, isTest } from '../env'
import { HttpError } from '../errors'
import { asyncHandler, requireRole, requireUser, type AuthedRequest } from '../http'

const router = Router()
const challengeLifetime = 5 * 60 * 1000
const ceremonyTimeout = 2 * 60 * 1000
const keyLimit = 10
const detail = { id: true, name: true, createdAt: true, lastUsedAt: true } as const

function relyingParty() {
  try {
    const url = new URL((env.nodeEnv === 'production' ? undefined : env.passkeyOrigin) ?? env.appOrigin)
    if (url.protocol === 'https:' || (env.nodeEnv !== 'production' && url.protocol === 'http:' && url.hostname === 'localhost')) {
      return { origin: url.origin, id: url.hostname }
    }
  } catch {
    // Passkeys stay unavailable until the application origin is configured.
  }
  return null
}

function requireOrigin(req: Request) {
  const party = relyingParty()
  if (!party || req.get('Origin') !== party.origin) throw new HttpError(403, 'PASSKEY_ORIGIN')
  return party
}

const credentialResponse = z.object({ id: z.string().min(1).max(2048), response: z.object({}).passthrough() }).passthrough()
const ceremonyResult = z.object({ challengeId: z.string().min(1).max(100), credential: credentialResponse })
export const passkeyLogin = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  ceremonyResult.extend({ action: z.literal('finish') }),
])

async function saveChallenge(userId: string, scope: string, value: string) {
  const now = new Date()
  await prisma.passkeyChallenge.deleteMany({ where: { userId, OR: [{ expiresAt: { lte: now } }, { scope }] } })
  const challenge = await prisma.passkeyChallenge.create({
    data: { userId, scope, value, expiresAt: new Date(now.getTime() + challengeLifetime) },
    select: { id: true },
  })
  return challenge.id
}

async function consumeChallenge(userId: string, scope: string, id: string) {
  const where = { id, userId, scope, expiresAt: { gt: new Date() } }
  const challenge = await prisma.passkeyChallenge.findFirst({ where, select: { value: true } })
  if (!challenge || (await prisma.passkeyChallenge.deleteMany({ where })).count !== 1) {
    throw new HttpError(400, 'PASSKEY_EXPIRED')
  }
  return challenge.value
}

export async function hasPasskeys(req: Request, userId: string) {
  const party = relyingParty()
  if (!party || req.get('Origin') !== party.origin) return false
  return Boolean(await prisma.adminPasskey.findFirst({ where: { userId }, select: { id: true } }))
}

export async function beginPasskeyLogin(req: Request, userId: string) {
  const party = requireOrigin(req)
  const keys = await prisma.adminPasskey.findMany({ where: { userId }, select: { id: true, transports: true } })
  if (keys.length === 0) throw new HttpError(400, 'PASSKEY_NONE')
  const options = await generateAuthenticationOptions({
    rpID: party.id,
    allowCredentials: keys.map((key) => ({ id: key.id, transports: key.transports as AuthenticatorTransport[] })),
    userVerification: 'required',
    timeout: ceremonyTimeout,
  })
  const challengeId = await saveChallenge(userId, 'login', options.challenge)
  return { options, challengeId }
}

export async function verifyPasskeyLogin(req: Request, userId: string, result: z.infer<typeof ceremonyResult>) {
  const party = requireOrigin(req)
  const expectedChallenge = await consumeChallenge(userId, 'login', result.challengeId)
  const key = await prisma.adminPasskey.findFirst({ where: { id: result.credential.id, userId } })
  if (!key) return false
  const response = result.credential as unknown as AuthenticationResponseJSON
  if (response.response.userHandle && response.response.userHandle !== Buffer.from(userId).toString('base64url')) return false
  let counter: bigint
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: party.origin,
      expectedRPID: party.id,
      requireUserVerification: true,
      credential: { id: key.id, publicKey: key.publicKey, counter: Number(key.counter) },
    })
    if (!verification.verified) return false
    counter = BigInt(verification.authenticationInfo.newCounter)
  } catch {
    return false
  }
  const updated = await prisma.adminPasskey.updateMany({
    where: { id: key.id, userId, counter: key.counter },
    data: { counter, lastUsedAt: new Date() },
  })
  return updated.count === 1
}

const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMIT')),
})

router.use(requireUser, requireRole('ADMIN'))

router.get('/', asyncHandler(async (req: AuthedRequest, res) => {
  const keys = await prisma.adminPasskey.findMany({ where: { userId: req.userId }, select: detail, orderBy: { createdAt: 'desc' } })
  res.setHeader('Cache-Control', 'no-store')
  res.json({ keys, origin: relyingParty()?.origin ?? null })
}))

router.post('/register/options', registrationLimiter, asyncHandler(async (req: AuthedRequest, res) => {
  const party = requireOrigin(req)
  const { token } = z.object({ token: z.string().regex(/^\d{6}$/) }).parse(req.body)
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.userId },
    select: { id: true, account: true, totpEnabled: true, totpSecret: true, passkeys: { select: { id: true } } },
  })
  if (!user.totpEnabled || !user.totpSecret || !verifyTotp(user.totpSecret, token)) throw new HttpError(400, 'TOTP_INVALID')
  if (user.passkeys.length >= keyLimit) throw new HttpError(409, 'PASSKEY_LIMIT')
  const options = await generateRegistrationOptions({
    rpName: '中科大畢業門檻追蹤',
    rpID: party.id,
    userName: user.account,
    userID: new TextEncoder().encode(user.id),
    excludeCredentials: user.passkeys,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    timeout: ceremonyTimeout,
  })
  const challengeId = await saveChallenge(user.id, `register:${req.sessionId}`, options.challenge)
  res.setHeader('Cache-Control', 'no-store')
  res.json({ options, challengeId })
}))

router.post('/register/verify', asyncHandler(async (req: AuthedRequest, res) => {
  const party = requireOrigin(req)
  const body = ceremonyResult.extend({ name: z.string().trim().min(1).max(50) }).parse(req.body)
  const userId = req.userId!
  const expectedChallenge = await consumeChallenge(userId, `register:${req.sessionId}`, body.challengeId)
  const verification = await verifyRegistrationResponse({
    response: body.credential as unknown as RegistrationResponseJSON,
    expectedChallenge,
    expectedOrigin: party.origin,
    expectedRPID: party.id,
    requireUserVerification: true,
  }).catch(() => null)
  if (!verification?.verified || !verification.registrationInfo) throw new HttpError(400, 'PASSKEY_INVALID')
  const { credential } = verification.registrationInfo
  const key = await prisma.$transaction(async (tx) => {
    if (await tx.adminPasskey.count({ where: { userId } }) >= keyLimit) throw new HttpError(409, 'PASSKEY_LIMIT')
    const existing = await tx.adminPasskey.findUnique({ where: { id: credential.id }, select: { id: true } })
    if (existing) throw new HttpError(409, 'PASSKEY_EXISTS')
    const created = await tx.adminPasskey.create({
      data: {
        id: credential.id, userId, name: body.name, publicKey: new Uint8Array(credential.publicKey),
        counter: BigInt(credential.counter), transports: credential.transports ?? [],
      },
      select: detail,
    })
    await audit({ actorId: userId, action: 'passkey.add', entityType: 'user', entityId: userId, summaryZh: '新增通行金鑰', summaryEn: 'Added a passkey' }, tx)
    return created
  })
  res.status(201).json({ key })
}))

router.delete('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  requireOrigin(req)
  const id = z.string().min(1).max(2048).parse(req.params.id)
  const userId = req.userId!
  await prisma.$transaction(async (tx) => {
    const removed = await tx.adminPasskey.deleteMany({ where: { id, userId } })
    if (removed.count !== 1) throw new HttpError(404, 'NOT_FOUND')
    await audit({ actorId: userId, action: 'passkey.remove', entityType: 'user', entityId: userId, summaryZh: '移除通行金鑰', summaryEn: 'Removed a passkey' }, tx)
  })
  res.json({ ok: true })
}))

export default router
