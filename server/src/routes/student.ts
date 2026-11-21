import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from '../db'
import { audit } from '../audit'
import { HttpError } from '../errors'
import { saveUpload } from '../files'
import { asyncHandler, requireRole, requireUser, type AuthedRequest } from '../http'
import { notify } from '../mail'
import { progressFor } from '../progress'

const router = Router()
router.use(requireUser, requireRole('STUDENT'))

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 3 } })

router.get(
  '/dashboard',
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { class: true } })
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED')
    const progress = await progressFor(user.id)
    const [recognized, submissions] = await Promise.all([
      prisma.recognizedItem.findMany({ where: { active: true }, orderBy: { nameZh: 'asc' } }),
      prisma.submission.findMany({
        where: { studentId: user.id },
        include: { files: true, threshold: true, recognizedItem: true },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    res.json({
      profile: {
        account: user.account,
        nameZh: user.nameZh,
        nameEn: user.nameEn,
        cohortYear: user.cohortYear,
        classNameZh: user.class?.nameZh ?? '',
        classNameEn: user.class?.nameEn ?? '',
        onboardingCompleted: user.onboardingCompleted,
      },
      progress,
      recognized,
      submissions: submissions.map(presentSubmission),
    })
  }),
)

router.get(
  '/plan',
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user?.cohortYear) return res.json({ items: [], progress: await progressFor(req.userId!) })
    const rule = await prisma.ruleSet.findUnique({
      where: { cohortYear: user.cohortYear },
      include: { planItems: { orderBy: [{ studyYear: 'asc' }, { sort: 'asc' }] } },
    })
    res.json({ items: rule?.planItems ?? [], progress: await progressFor(user.id), sourceNoteZh: rule?.sourceNoteZh, sourceNoteEn: rule?.sourceNoteEn })
  }),
)

router.post(
  '/submissions',
  upload.array('files', 3),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        thresholdId: z.string().min(1),
        recognizedItemId: z.string().optional(),
        scoreText: z.string().max(40).optional(),
        note: z.string().max(500).optional(),
      })
      .parse(req.body)
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user?.cohortYear) throw new HttpError(400, 'VALIDATION')
    const threshold = await prisma.threshold.findFirst({
      where: { id: body.thresholdId, ruleSet: { cohortYear: user.cohortYear }, kind: { not: 'INFO' } },
    })
    if (!threshold) throw new HttpError(404, 'NOT_FOUND')
    const expectedType =
      threshold.code === 'ENGLISH' || threshold.code === 'CERTIFICATION' || threshold.code === 'COMPETITION'
        ? threshold.code
        : null
    let recognized = null
    if (expectedType && !body.recognizedItemId) throw new HttpError(400, 'VALIDATION')
    if (body.recognizedItemId) {
      recognized = await prisma.recognizedItem.findFirst({ where: { id: body.recognizedItemId, active: true } })
      if (!recognized) throw new HttpError(400, 'VALIDATION')
      if (expectedType && recognized.type !== expectedType) throw new HttpError(400, 'VALIDATION')
      if (recognized.minScore != null) {
        const score = Number(body.scoreText)
        if (!Number.isFinite(score) || score < recognized.minScore) throw new HttpError(400, 'SCORE_TOO_LOW')
      }
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (!files.length) throw new HttpError(400, 'FILE_TYPE')
    const stored = []
    for (const file of files) {
      const saved = await saveUpload(file.buffer)
      if (!saved) throw new HttpError(400, 'FILE_TYPE')
      stored.push({ ...saved, originalName: file.originalname.slice(0, 180) })
    }
    const submission = await prisma.submission.create({
      data: {
        studentId: user.id,
        thresholdId: threshold.id,
        recognizedItemId: recognized?.id,
        scoreText: body.scoreText || null,
        note: body.note || null,
        files: { create: stored.map((file) => ({ storageKey: file.storageKey, originalName: file.originalName, mimeType: file.mime, size: file.size })) },
      },
      include: { files: true },
    })
    await audit({
      actorId: user.id,
      action: 'submission.create',
      entityType: 'submission',
      entityId: submission.id,
      summaryZh: `上傳 ${threshold.nameZh} 證明`,
      summaryEn: `Uploaded evidence for ${threshold.nameEn}`,
    })
    res.status(201).json({ id: submission.id })
  }),
)

router.post(
  '/onboarding',
  asyncHandler(async (req: AuthedRequest, res) => {
    await prisma.user.update({ where: { id: req.userId }, data: { onboardingCompleted: true } })
    res.json({ ok: true })
  }),
)

router.get(
  '/notifications',
  asyncHandler(async (req: AuthedRequest, res) => {
    const rows = await prisma.notification.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ notifications: rows })
  }),
)

router.post(
  '/notifications/read',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ id: z.string().optional() }).parse(req.body ?? {})
    await prisma.notification.updateMany({
      where: { userId: req.userId, ...(body.id ? { id: body.id } : {}), readAt: null },
      data: { readAt: new Date() },
    })
    res.json({ ok: true })
  }),
)

export function presentSubmission(submission: {
  id: string
  status: string
  scoreText: string | null
  note: string | null
  reviewComment: string | null
  teacherComment: string | null
  teacherRecommendation: string | null
  createdAt: Date
  reviewedAt: Date | null
  threshold?: { nameZh: string; nameEn: string; code: string }
  recognizedItem?: { nameZh: string; nameEn: string } | null
  files: { id: string; originalName: string; mimeType: string; size: number }[]
  student?: { id: string; account: string; nameZh: string; nameEn: string }
}) {
  return {
    id: submission.id,
    status: submission.status,
    scoreText: submission.scoreText,
    note: submission.note,
    reviewComment: submission.reviewComment,
    teacherComment: submission.teacherComment,
    teacherRecommendation: submission.teacherRecommendation,
    createdAt: submission.createdAt,
    reviewedAt: submission.reviewedAt,
    threshold: submission.threshold,
    recognizedItem: submission.recognizedItem,
    files: submission.files,
    student: submission.student,
  }
}

export async function tellStudentReviewed(studentId: string, passed: boolean, comment: string) {
  await notify({
    userId: studentId,
    kind: passed ? 'review.approved' : 'review.rejected',
    titleZh: passed ? '證明已通過' : '證明已退回',
    titleEn: passed ? 'Evidence approved' : 'Evidence returned',
    bodyZh: comment || (passed ? '系上已核可你上傳的證明，進度已更新。' : '請依意見補件後重新上傳。'),
    bodyEn: comment || (passed ? 'The department approved your evidence and your progress was updated.' : 'Upload a new file after you address the comment.'),
  })
}

export default router
