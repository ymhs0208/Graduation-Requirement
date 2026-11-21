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
import { publicUser } from '../progress'
import { env, isTest } from '../env'

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

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        account: z.string().trim().min(1).max(40),
        password: z.string().min(1).max(200),
        totp: z.string().optional(),
      })
      .parse(req.body)
    const user = await prisma.user.findUnique({ where: { account: body.account } })
    if (!user) throw new HttpError(401, 'INVALID_CREDENTIALS')
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw new HttpError(423, 'LOCKED')
    if (user.status !== 'ACTIVE' || user.anonymizedAt) throw new HttpError(403, 'DEACTIVATED')
    const ok = await verifyPassword(user.passwordHash, body.password)
    if (!ok) {
      const fails = user.failedLoginCount + 1
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: fails,
          lockedUntil: fails >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      })
      throw new HttpError(401, 'INVALID_CREDENTIALS')
    }
    if (user.totpEnabled) {
      if (!body.totp) throw new HttpError(401, 'TOTP_REQUIRED')
      if (!user.totpSecret || !verifyTotp(user.totpSecret, body.totp)) {
        const fails = user.failedLoginCount + 1
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: fails,
            lockedUntil: fails >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
          },
        })
        throw new HttpError(401, 'TOTP_INVALID')
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
    const secret = newTotpSecret()
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret, totpEnabled: false } })
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
