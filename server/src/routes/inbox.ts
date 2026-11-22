import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { HttpError } from '../errors'
import { asyncHandler, requireUser, type AuthedRequest } from '../http'

const router = Router()
router.use(requireUser)

router.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ notifications })
  }),
)

router.post(
  '/read',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = z.object({ id: z.string().min(1).max(100).optional() }).parse(req.body ?? {})
    const readAt = new Date()
    const where = { userId: req.userId, ...(id ? { id } : {}) }
    const updated = await prisma.notification.updateMany({ where: { ...where, readAt: null }, data: { readAt } })
    if (!id) return res.json({ ok: true })
    if (updated.count === 1) return res.json({ readAt })
    const notification = await prisma.notification.findFirst({ where, select: { readAt: true } })
    if (!notification?.readAt) throw new HttpError(404, 'NOT_FOUND')
    res.json({ readAt: notification.readAt })
  }),
)

export default router
