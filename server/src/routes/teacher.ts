import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { audit } from '../audit'
import { asyncHandler, advisedStudent, pid, requireRole, requireUser, type AuthedRequest } from '../http'
import { notify } from '../mail'
import { progressFor } from '../progress'
import { presentSubmission } from './student'

const router = Router()
router.use(requireUser, requireRole('TEACHER'))

router.get(
  '/classes',
  asyncHandler(async (req: AuthedRequest, res) => {
    const classes = await prisma.class.findMany({
      where: { advisorId: req.userId },
      orderBy: { cohortYear: 'asc' },
      include: { _count: { select: { students: true } } },
    })
    res.json({ classes })
  }),
)

router.get(
  '/students',
  asyncHandler(async (req: AuthedRequest, res) => {
    const atRisk = req.query.atRisk === '1'
    const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined
    const classes = await prisma.class.findMany({ where: { advisorId: req.userId } })
    const allowed = new Set(classes.map((item) => item.id))
    if (classId && !allowed.has(classId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT', classId: classId ?? { in: [...allowed] } },
      include: { class: true },
      orderBy: { account: 'asc' },
    })
    const rows = []
    for (const student of students) {
      const progress = await progressFor(student.id)
      if (atRisk && !progress.atRisk) continue
      rows.push({
        id: student.id,
        account: student.account,
        nameZh: student.nameZh,
        nameEn: student.nameEn,
        status: student.status,
        cohortYear: student.cohortYear,
        classNameZh: student.class?.nameZh ?? '',
        classNameEn: student.class?.nameEn ?? '',
        verdict: progress.verdict,
        atRisk: progress.atRisk,
        delayed: progress.delayed,
        earnedTowardTotal: progress.earnedTowardTotal,
        requiredTotal: progress.requiredTotal,
        missing: progress.missing,
      })
    }
    res.json({ students: rows })
  }),
)

router.get(
  '/students/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const student = await advisedStudent(req.userId!, pid(req.params.id))
    const [progress, submissions, comments, credits] = await Promise.all([
      progressFor(student.id),
      prisma.submission.findMany({
        where: { studentId: student.id },
        include: { files: true, threshold: true, recognizedItem: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.comment.findMany({
        where: { studentId: student.id },
        include: { author: { select: { nameZh: true, nameEn: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.creditRecord.findMany({ where: { studentId: student.id }, orderBy: [{ termYear: 'asc' }, { termSemester: 'asc' }] }),
    ])
    res.json({
      student: {
        id: student.id,
        account: student.account,
        nameZh: student.nameZh,
        nameEn: student.nameEn,
        email: student.email,
        status: student.status,
        cohortYear: student.cohortYear,
        deactivationReason: student.deactivationReason,
        anonymized: Boolean(student.anonymizedAt),
      },
      progress,
      submissions: submissions.map(presentSubmission),
      comments,
      credits,
    })
  }),
)

router.post(
  '/students/:id/comments',
  asyncHandler(async (req: AuthedRequest, res) => {
    const student = await advisedStudent(req.userId!, pid(req.params.id))
    const body = z.object({ body: z.string().trim().min(1).max(1000) }).parse(req.body)
    const comment = await prisma.comment.create({ data: { studentId: student.id, authorId: req.userId!, body: body.body } })
    await notify({
      userId: student.id,
      kind: 'teacher.reminder',
      titleZh: '班導提醒',
      titleEn: 'Message from your advisor',
      bodyZh: body.body,
      bodyEn: body.body,
    })
    await audit({
      actorId: req.userId,
      action: 'comment.create',
      entityType: 'student',
      entityId: student.id,
      summaryZh: `班導提醒 ${student.account}`,
      summaryEn: `Advisor reminder for ${student.account}`,
      after: { commentId: comment.id },
    })
    res.status(201).json({ id: comment.id })
  }),
)

export default router
