import { Router } from 'express'
import { prisma } from '../db'
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
    await prisma.notification.updateMany({ where: { userId: req.userId, readAt: null }, data: { readAt: new Date() } })
    res.json({ ok: true })
  }),
)

export default router
