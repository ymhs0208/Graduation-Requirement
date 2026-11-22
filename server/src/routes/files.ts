import { Router } from 'express'
import { prisma } from '../db'
import { resolveStored, uploadDisposition } from '../files'
import { asyncHandler, pid, requireUser, type AuthedRequest } from '../http'
import fs from 'fs'

const router = Router()

router.get(
  '/:id',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const file = await prisma.upload.findUnique({
      where: { id: pid(req.params.id) },
      include: { submission: { include: { student: { include: { class: true } } } } },
    })
    if (!file) return res.status(404).json({ error: 'NOT_FOUND' })
    const student = file.submission.student
    const allowed =
      req.role === 'ADMIN' ||
      (req.role === 'STUDENT' && student.id === req.userId) ||
      (req.role === 'TEACHER' && student.class?.advisorId === req.userId)
    if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' })
    const full = resolveStored(file.storageKey)
    if (!full || !fs.existsSync(full)) return res.status(404).json({ error: 'NOT_FOUND' })
    const inline = req.query.disposition === 'inline'
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', uploadDisposition(file.originalName, inline))
    fs.createReadStream(full).pipe(res)
  }),
)

export default router
