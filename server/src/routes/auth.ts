import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../db'
import { audit } from '../audit'
import {
  currentTotp,
  hashPassword,
  newTotpSecret,
  passwordIssues,
  randomToken,
  sha256,
  tempPassword,
  totpUri,
  verifyPassword,
  verifyTotp,
} from '../crypto'
import { HttpError } from '../errors'
import { asyncHandler, cookieOptions, requireUser, type AuthedRequest } from '../http'
import { sendMail } from '../mail'
import { messages } from '../messages'
import { publicUser } from '../progress'
import { env, isTest } from '../env'
import passkeys, { beginPasskeyLogin, hasPasskeys, passkeyLogin, verifyPasskeyLogin } from './passkeys'

const router = Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req, res) => {
    res.status(429).json({ error: 'RATE_LIMIT' })
  },
})

const schoolEmail = z.string().trim().email().refine((value) => value.toLowerCase().endsWith('@nutc.edu.tw'), 'school-email')

async function failLogin(user: { id: string; failedLoginCount: number }, code: string): Promise<never> {
  const fails = user.failedLoginCount + 1
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: { increment: 1 },
      ...(fails >= 5 ? { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) } : {}),
    },
  })
  throw new HttpError(401, code)
}

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        account: z.string().trim().min(1).max(40),
        password: z.string().min(1).max(200),
        totp: z.string().optional(),
        passkey: passkeyLogin.optional(),
      })
      .parse(req.body)
    const user = await prisma.user.findUnique({ where: { account: body.account } })
    if (!user) throw new HttpError(401, 'INVALID_CREDENTIALS')
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw new HttpError(423, 'LOCKED')
    if (user.status !== 'ACTIVE' || user.anonymizedAt) throw new HttpError(403, 'DEACTIVATED')
    const ok = await verifyPassword(user.passwordHash, body.password)
    if (!ok) await failLogin(user, 'INVALID_CREDENTIALS')
    if (body.passkey) {
      if (user.role !== 'ADMIN' || !user.totpEnabled) throw new HttpError(403, 'FORBIDDEN')
      if (body.passkey.action === 'start') {
        res.setHeader('Cache-Control', 'no-store')
        return res.json(await beginPasskeyLogin(req, user.id))
      }
      if (!await verifyPasskeyLogin(req, user.id, body.passkey)) await failLogin(user, 'PASSKEY_INVALID')
    } else if (user.totpEnabled) {
      if (!body.totp) {
        const passkeyAvailable = user.role === 'ADMIN' && await hasPasskeys(req, user.id)
        const { zh: messageZh, en: messageEn } = messages.TOTP_REQUIRED
        return res.status(401).json({ error: 'TOTP_REQUIRED', messageZh, messageEn, passkeyAvailable })
      }
      if (!user.totpSecret || !verifyTotp(user.totpSecret, body.totp)) {
        await failLogin(user, 'TOTP_INVALID')
      }
    }
    await prisma.session.deleteMany({ where: { userId: user.id } })
    const token = randomToken()
    const csrf = randomToken()
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        csrfSecret: csrf,
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        ip: req.ip,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
      },
    })
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } })
    res.cookie('gt_session', token, cookieOptions())
    res.json({ user: publicUser(user), csrfToken: csrf })
  }),
)

router.use('/passkeys', passkeys)

router.post(
  '/logout',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (req.sessionId) await prisma.session.delete({ where: { id: req.sessionId } }).catch(() => undefined)
    res.clearCookie('gt_session', cookieOptions())
    res.json({ ok: true })
  }),
)

router.get(
  '/me',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED')
    res.json({ user: publicUser(user), csrfToken: req.csrf })
  }),
)

router.post(
  '/password',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ currentPassword: z.string().min(1), nextPassword: z.string().min(1).max(200) }).parse(req.body)
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED')
    const ok = await verifyPassword(user.passwordHash, body.currentPassword)
    if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS')
    const issues = passwordIssues(body.nextPassword, user.account)
    if (issues.length) throw new HttpError(400, 'WEAK_PASSWORD')
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.nextPassword), mustChangePassword: false },
    })
    await prisma.session.deleteMany({ where: { userId: user.id, id: { not: req.sessionId } } })
    await audit({
      actorId: user.id,
      action: 'password.change',
      entityType: 'user',
      entityId: user.id,
      summaryZh: '變更密碼',
      summaryEn: 'Password changed',
    })
    res.json({ ok: true })
  }),
)

router.post(
  '/forgot',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = z.object({ account: z.string().trim().min(1).max(40) }).parse(req.body)
    const user = await prisma.user.findUnique({ where: { account: body.account } })
    if (user && user.status === 'ACTIVE' && !user.anonymizedAt && user.email.toLowerCase().endsWith('@nutc.edu.tw')) {
      const token = randomToken()
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          purpose: 'reset',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      })
      const link = `${env.appOrigin}/reset?token=${encodeURIComponent(token)}`
      await sendMail(
        user.email,
        '畢業門檻系統密碼重設',
        `請在 30 分鐘內開啟此連結設定新密碼。此連結只能使用一次。\n${link}\n\nReset your password within 30 minutes. The link works once.\n${link}`,
      )
    }
    res.json({ ok: true })
  }),
)

router.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const body = z.object({ token: z.string().min(10), password: z.string().min(1).max(200) }).parse(req.body)
    const row = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(body.token) }, include: { user: true } })
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw new HttpError(400, 'TOKEN_INVALID')
    if (row.user.status !== 'ACTIVE' || row.user.anonymizedAt) throw new HttpError(403, 'DEACTIVATED')
    const issues = passwordIssues(body.password, row.user.account)
    if (issues.length) throw new HttpError(400, 'WEAK_PASSWORD')
    await prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } })
    await prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: await hashPassword(body.password), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
    })
    await prisma.session.deleteMany({ where: { userId: row.userId } })
    await audit({
      actorId: row.userId,
      action: 'password.reset',
      entityType: 'user',
      entityId: row.userId,
      summaryZh: '以信件連結重設密碼',
      summaryEn: 'Password reset from email link',
    })
    res.json({ ok: true })
  }),
)

router.post(
  '/totp/setup',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN')
    if (user.totpEnabled) throw new HttpError(409, 'TOTP_ALREADY_ENABLED')
    const secret = user.totpSecret ?? newTotpSecret()
    if (!user.totpSecret) {
      const updated = await prisma.user.updateMany({ where: { id: user.id, totpEnabled: false, totpSecret: null }, data: { totpSecret: secret } })
      if (updated.count !== 1) throw new HttpError(409, 'TOTP_SETUP_RETRY')
    }
    res.json({ secret, uri: totpUri(secret, user.account), sample: currentTotp(secret) })
  }),
)

router.post(
  '/totp/enable',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ token: z.string().min(6).max(8) }).parse(req.body)
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'ADMIN' || !user.totpSecret) throw new HttpError(400, 'TOTP_INVALID')
    if (!verifyTotp(user.totpSecret, body.token)) throw new HttpError(400, 'TOTP_INVALID')
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } })
    await audit({
      actorId: user.id,
      action: 'totp.enable',
      entityType: 'user',
      entityId: user.id,
      summaryZh: '啟用管理員雙因素驗證',
      summaryEn: 'Enabled admin TOTP',
    })
    res.json({ ok: true })
  }),
)

router.patch(
  '/locale',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ locale: z.enum(['zh-Hant', 'en']) }).parse(req.body)
    await prisma.user.update({ where: { id: req.userId }, data: { locale: body.locale } })
    res.json({ ok: true })
  }),
)

export async function issueActivation(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return null
  const token = randomToken()
  const password = tempPassword()
  await prisma.passwordReset.create({
    data: {
      userId,
      tokenHash: sha256(token),
      purpose: 'activate',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password), mustChangePassword: true },
  })
  const link = `${env.appOrigin}/reset?token=${encodeURIComponent(token)}`
  await sendMail(
    user.email,
    '畢業門檻系統帳號啟用',
    `帳號：${user.account}\n暫時密碼：${password}\n或使用一次性連結（7 日內、僅一次）設定密碼：\n${link}\n首次登入後必須變更密碼。`,
  )
  return { account: user.account, tempPassword: password }
}

export { schoolEmail }
export default router
