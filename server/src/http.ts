import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { prisma } from './db'
import { HttpError } from './errors'
import { sha256, safeEqual } from './crypto'
import { isTest } from './env'
import { messages } from './messages'

const IDLE_MS = 30 * 60 * 1000
const ABSOLUTE_MS = 12 * 60 * 60 * 1000

export interface AuthedRequest extends Request {
  userId?: string
  sessionId?: string
  csrf?: string
  role?: string
}

export async function loadSession(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.gt_session as string | undefined
  if (!token) return next()
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  })
  if (!session) return next()
  const now = Date.now()
  if (session.expiresAt.getTime() < now || now - session.lastSeenAt.getTime() > IDLE_MS || now - session.createdAt.getTime() > ABSOLUTE_MS) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined)
    res.clearCookie('gt_session', cookieOptions())
    return next()
  }
  if (session.user.status !== 'ACTIVE' || session.user.anonymizedAt) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined)
    res.clearCookie('gt_session', cookieOptions())
    return next()
  }
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
  }
  req.userId = session.userId
  req.sessionId = session.id
  req.csrf = session.csrfSecret
  req.role = session.user.role
  next()
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: ABSOLUTE_MS,
  }
}

const csrfFree = new Set(['/api/auth/login', '/api/auth/forgot', '/api/auth/reset'])

export function requireCsrf(req: AuthedRequest, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  if (csrfFree.has(req.path) || !req.sessionId) return next()
  const header = String(req.header('x-csrf-token') ?? '')
  if (!req.csrf || !header || !safeEqual(header, req.csrf)) {
    return res.status(403).json({ error: 'CSRF' })
  }
  next()
}

export async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ error: 'UNAUTHENTICATED' })
  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'UNAUTHENTICATED' })
  const full = `${req.baseUrl}${req.path}`
  const open =
    full.startsWith('/api/auth/password') ||
    full.startsWith('/api/auth/logout') ||
    full.startsWith('/api/auth/me') ||
    full.startsWith('/api/auth/totp')
  if (user.mustChangePassword && !open) return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' })
  if (user.role === 'ADMIN' && !user.totpEnabled && !open) {
    return res.status(403).json({ error: 'TOTP_SETUP_REQUIRED' })
  }
  next()
}

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.role || !roles.includes(req.role)) return res.status(403).json({ error: 'FORBIDDEN' })
    next()
  }
}

export async function advisedStudent(teacherId: string, studentId: string) {
  const student = await prisma.user.findUnique({ where: { id: studentId }, include: { class: true } })
  if (!student || student.role !== 'STUDENT') throw new HttpError(404, 'NOT_FOUND')
  if (student.class?.advisorId !== teacherId) throw new HttpError(403, 'FORBIDDEN')
  return student
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    const text = messages[err.code]
    return res.status(err.status).json({ error: err.code, messageZh: err.messageZh ?? text?.zh, messageEn: err.messageEn ?? text?.en })
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'VALIDATION',
      messageZh: messages.VALIDATION.zh,
      messageEn: messages.VALIDATION.en,
      issues: err.issues.map((issue) => issue.message),
    })
  }
  const multerCode = typeof err === 'object' && err && 'code' in err ? String((err as { code: string }).code) : ''
  if (multerCode.startsWith('LIMIT_')) {
    const code = multerCode === 'LIMIT_FILE_SIZE' ? 'FILE_SIZE' : 'VALIDATION'
    return res.status(400).json({ error: code, messageZh: messages[code].zh, messageEn: messages[code].en })
  }
  console.error(err)
  return res.status(500).json({ error: 'SERVER', messageZh: messages.SERVER.zh, messageEn: messages.SERVER.en })
}

export function pid(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) throw new HttpError(400, 'VALIDATION')
  return raw
}

export function asyncHandler(fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next)
  }
}

export { isTest }
