import { Router } from 'express'
import planRoutes from './admin-plan'
import { randomUUID } from 'node:crypto'
import multer from 'multer'
import { stringify } from 'csv-stringify/sync'
import { z } from 'zod'
import { prisma } from '../db'
import { audit } from '../audit'
import { HttpError } from '../errors'
import { asyncHandler, pid, requireRole, requireUser, type AuthedRequest } from '../http'
import { anonymizeUser, purgeRetention, retentionCandidates, runPreaudit, runReminders } from '../jobs'
import { progressFor } from '../progress'
import { issueActivation } from './auth'
import { presentSubmission, tellStudentReviewed } from './student'
import { accountFormatIssue, emailIssue, inspectCredits } from '../csv-import'
import { buildPreview, commitPreview, errorsBody, loadCreditContext, previewBody, readPreview, templateBody } from '../import-commit'

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500_000, files: 1 } })

const router = Router()
router.use(requireUser, requireRole('ADMIN'))
router.use('/plans', planRoutes)

const accountSchema = z.string().trim().min(1).max(20)

router.get('/import/template', (req, res) => {
  const kind = req.query.kind === 'credits' ? 'credits' : 'accounts'
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${kind}-template.csv"`)
  res.send(templateBody(kind))
})

router.post(
  '/import/preview',
  csvUpload.single('file'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const kindRaw = String(req.body?.kind ?? req.query.kind ?? '')
    if (kindRaw !== 'accounts' && kindRaw !== 'credits') throw new HttpError(400, 'VALIDATION')
    const buf = req.file?.buffer ?? (typeof req.body?.csv === 'string' ? Buffer.from(req.body.csv, 'utf8') : null)
    if (!buf?.length) throw new HttpError(400, 'CSV_EMPTY')
    const built = await buildPreview(req.userId!, kindRaw, buf)
    res.json(previewBody(built))
  }),
)

router.get(
  '/import/:id/errors',
  asyncHandler(async (req: AuthedRequest, res) => {
    const preview = readPreview(pid(req.params.id), req.userId!)
    if (!preview) throw new HttpError(404, 'PREVIEW_EXPIRED')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="import-errors.csv"')
    res.send(errorsBody(preview))
  }),
)

router.post(
  '/import/commit',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        previewId: z.string().min(8),
        conflict: z.enum(['skip', 'update']),
        confirm: z.literal(true),
      })
      .parse(req.body)
    const result = await commitPreview(req.userId!, body.previewId, body.conflict)
    if (!result) throw new HttpError(404, 'PREVIEW_EXPIRED')
    res.json(result)
  }),
)

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const cohortYear = Number(req.query.cohort)
    const cohorts = await prisma.user.findMany({
      where: { role: 'STUDENT', anonymizedAt: null },
      distinct: ['cohortYear'],
      select: { cohortYear: true },
      orderBy: { cohortYear: 'asc' },
    })
    const year = Number.isFinite(cohortYear) && cohortYear > 0 ? cohortYear : cohorts.at(-1)?.cohortYear
    if (!year) return res.json({ cohorts: [], stats: null, students: [] })
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT', cohortYear: year, anonymizedAt: null },
      include: { class: true },
      orderBy: { account: 'asc' },
    })
    const rows = []
    for (const student of students) {
      const progress = await progressFor(student.id)
      const cert = await prisma.submission.findFirst({
        where: {
          studentId: student.id,
          status: 'APPROVED',
          recognizedItem: { type: 'CERTIFICATION', countsAsPass: true },
        },
      })
      rows.push({
        id: student.id,
        account: student.account,
        nameZh: student.nameZh,
        nameEn: student.nameEn,
        classNameZh: student.class?.nameZh ?? '',
        status: student.status,
        verdict: progress.verdict,
        atRisk: progress.atRisk,
        delayed: progress.delayed,
        english: progress.thresholds.find((item) => item.code === 'ENGLISH')?.state ?? 'missing',
        certified: Boolean(cert),
        earnedTowardTotal: progress.earnedTowardTotal,
        requiredTotal: progress.requiredTotal,
      })
    }
    const active = rows.filter((row) => row.status === 'ACTIVE')
    const base = active.length || 1
    res.json({
      cohorts: cohorts.map((item) => item.cohortYear).filter(Boolean),
      cohortYear: year,
      stats: {
        students: rows.length,
        active: active.length,
        englishPassRate: active.filter((row) => row.english === 'passed').length / base,
        certificationRate: active.filter((row) => row.certified).length / base,
        atRisk: active.filter((row) => row.atRisk).length,
        delayed: active.filter((row) => row.delayed).length,
        ready: active.filter((row) => row.verdict === 'ready').length,
        blocked: active.filter((row) => row.verdict === 'blocked').length,
        needsOffice: active.filter((row) => row.verdict === 'needs_office').length,
      },
      students: rows,
    })
  }),
)

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const cohortYear = Number(req.query.cohort)
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT', cohortYear, anonymizedAt: null },
      include: { class: true },
      orderBy: { account: 'asc' },
    })
    const records = []
    for (const student of students) {
      const progress = await progressFor(student.id)
      records.push({
        account: student.account,
        nameZh: student.nameZh,
        class: student.class?.nameZh ?? '',
        cohortYear: student.cohortYear,
        status: student.status,
        verdict: progress.verdict,
        atRisk: progress.atRisk,
        delayed: progress.delayed,
        earned: progress.earnedTowardTotal,
        required: progress.requiredTotal ?? '',
        missing: progress.missing.map((item) => item.nameZh).join('|'),
        office: progress.office.map((item) => item.nameZh).join('|'),
      })
    }
    const csv = stringify(records, { header: true })
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="graduation-${cohortYear}.csv"`)
    res.send(`\uFEFF${csv}`)
  }),
)

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const [users, classes] = await Promise.all([
      prisma.user.findMany({ include: { class: true }, orderBy: { account: 'asc' } }),
      prisma.class.findMany({ orderBy: [{ cohortYear: 'asc' }, { nameZh: 'asc' }] }),
    ])
    res.json({
      users: users.map((user) => ({
        id: user.id,
        account: user.account,
        email: user.email,
        nameZh: user.nameZh,
        nameEn: user.nameEn,
        role: user.role,
        status: user.status,
        cohortYear: user.cohortYear,
        classId: user.classId,
        classNameZh: user.class?.nameZh ?? '',
        deactivationReason: user.deactivationReason,
        anonymized: Boolean(user.anonymizedAt),
        totpEnabled: user.totpEnabled,
      })),
      classes,
    })
  }),
)

router.post(
  '/users',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        account: accountSchema,
        nameZh: z.string().trim().min(1).max(40),
        nameEn: z.string().trim().min(1).max(80),
        email: z.string().trim().min(1).max(120),
        role: z.enum(['STUDENT', 'TEACHER', 'ADMIN']),
        cohortYear: z.number().int().min(100).max(200).optional(),
        classId: z.string().optional(),
      })
      .parse(req.body)
    const accountCode = accountFormatIssue(body.role, body.account)
    if (accountCode) throw new HttpError(400, 'BAD_ACCOUNT')
    if (emailIssue(body.email)) throw new HttpError(400, 'BAD_EMAIL')
    if (body.role === 'STUDENT') {
      if (!body.cohortYear) throw new HttpError(400, 'BAD_COHORT')
      const rule = await prisma.ruleSet.findUnique({ where: { cohortYear: body.cohortYear } })
      if (!rule) throw new HttpError(400, 'BAD_COHORT')
    }
    if (body.classId) {
      const found = await prisma.class.findUnique({ where: { id: body.classId } })
      if (!found || (body.cohortYear != null && found.cohortYear !== body.cohortYear)) throw new HttpError(400, 'BAD_CLASS')
    }
    const created = await prisma.user.create({
      data: {
        account: body.account,
        nameZh: body.nameZh,
        nameEn: body.nameEn,
        email: body.email.toLowerCase(),
        role: body.role,
        cohortYear: body.cohortYear ?? null,
        classId: body.classId || null,
        passwordHash: 'pending',
        mustChangePassword: true,
      },
    })
    const issued = await issueActivation(created.id)
    await audit({
      actorId: req.userId,
      action: 'user.create',
      entityType: 'user',
      entityId: created.id,
      summaryZh: `建立帳號 ${created.account}`,
      summaryEn: `Created account ${created.account}`,
      after: { role: created.role, cohortYear: created.cohortYear },
    })
    res.status(201).json({ id: created.id, tempPassword: issued?.tempPassword })
  }),
)

router.patch(
  '/users/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
        deactivationReason: z.enum(['SUSPENDED', 'TRANSFERRED', 'GRADUATED', 'OTHER']).optional(),
        classId: z.string().nullable().optional(),
        cohortYear: z.number().int().nullable().optional(),
        role: z.enum(['STUDENT', 'TEACHER', 'ADMIN']).optional(),
        nameZh: z.string().trim().min(1).max(40).optional(),
        nameEn: z.string().trim().min(1).max(80).optional(),
      })
      .parse(req.body)
    const before = await prisma.user.findUnique({ where: { id: pid(req.params.id) } })
    if (!before || before.anonymizedAt) throw new HttpError(404, 'NOT_FOUND')
    const data: Record<string, unknown> = {}
    if (body.classId !== undefined) data.classId = body.classId
    if (body.cohortYear !== undefined) data.cohortYear = body.cohortYear
    if (body.role) data.role = body.role
    if (body.nameZh) data.nameZh = body.nameZh
    if (body.nameEn) data.nameEn = body.nameEn
    if (body.status === 'DEACTIVATED') {
      data.status = 'DEACTIVATED'
      data.deactivationReason = body.deactivationReason ?? 'OTHER'
      data.deactivatedAt = new Date()
    }
    if (body.status === 'ACTIVE') {
      data.status = 'ACTIVE'
      data.deactivationReason = null
      data.deactivatedAt = null
    }
    const user = await prisma.user.update({ where: { id: before.id }, data })
    if (body.status === 'DEACTIVATED') await prisma.session.deleteMany({ where: { userId: user.id } })
    await audit({
      actorId: req.userId,
      action: 'user.update',
      entityType: 'user',
      entityId: user.id,
      summaryZh: `更新帳號 ${before.account}`,
      summaryEn: `Updated account ${before.account}`,
      before: { status: before.status, role: before.role, classId: before.classId, cohortYear: before.cohortYear },
      after: { status: user.status, role: user.role, classId: user.classId, cohortYear: user.cohortYear, reason: user.deactivationReason },
    })
    res.json({ ok: true })
  }),
)

router.post(
  '/users/import',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({ csv: z.string().min(1).max(500_000), confirm: z.literal(true).optional(), conflict: z.enum(['skip', 'update']).optional() })
      .parse(req.body)
    const built = await buildPreview(req.userId!, 'accounts', Buffer.from(body.csv, 'utf8'))
    if (body.confirm !== true) return res.json(previewBody(built))
    const result = await commitPreview(req.userId!, built.id, body.conflict ?? 'skip')
    if (!result) throw new HttpError(404, 'PREVIEW_EXPIRED')
    res.json(result)
  }),
)

router.post(
  '/classes',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        nameZh: z.string().trim().min(1).max(40),
        nameEn: z.string().trim().min(1).max(80),
        cohortYear: z.number().int(),
        advisorId: z.string().nullable().optional(),
      })
      .parse(req.body)
    const created = await prisma.class.create({ data: body })
    await audit({
      actorId: req.userId,
      action: 'class.create',
      entityType: 'class',
      entityId: created.id,
      summaryZh: `建立班級 ${created.nameZh}`,
      summaryEn: `Created class ${created.nameEn}`,
    })
    res.status(201).json(created)
  }),
)

router.patch(
  '/classes/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ advisorId: z.string().nullable() }).parse(req.body)
    const before = await prisma.class.findUnique({ where: { id: pid(req.params.id) } })
    if (!before) throw new HttpError(404, 'NOT_FOUND')
    const updated = await prisma.class.update({ where: { id: before.id }, data: { advisorId: body.advisorId } })
    await audit({
      actorId: req.userId,
      action: 'class.advisor',
      entityType: 'class',
      entityId: updated.id,
      summaryZh: `調整 ${updated.nameZh} 班導`,
      summaryEn: `Changed advisor for ${updated.nameEn}`,
      before: { advisorId: before.advisorId },
      after: { advisorId: updated.advisorId },
    })
    res.json({ ok: true })
  }),
)

router.get(
  '/rules',
  asyncHandler(async (_req, res) => {
    const rules = await prisma.ruleSet.findMany({
      include: { categories: { orderBy: { sort: 'asc' } }, thresholds: { orderBy: { sort: 'asc' } } },
      orderBy: { cohortYear: 'asc' },
    })
    res.json({ rules })
  }),
)

router.patch(
  '/rules/:cohort',
  asyncHandler(async (req: AuthedRequest, res) => {
    const cohortYear = Number(req.params.cohort)
    const body = z
      .object({
        totalCredits: z.number().int().nullable().optional(),
        totalCreditsConfirmed: z.boolean().optional(),
        summaryZh: z.string().max(2000).optional(),
        summaryEn: z.string().max(2000).optional(),
        categories: z
          .array(
            z.object({
              id: z.string(),
              requiredCredits: z.number().nullable(),
              isPlaceholder: z.boolean(),
              noteZh: z.string().max(1000),
              noteEn: z.string().max(1000),
            }),
          )
          .optional(),
      })
      .parse(req.body)
    const before = await prisma.ruleSet.findUnique({ where: { cohortYear } })
    if (!before) throw new HttpError(404, 'NOT_FOUND')
    await prisma.ruleSet.update({
      where: { cohortYear },
      data: {
        totalCredits: body.totalCredits === undefined ? undefined : body.totalCredits,
        totalCreditsConfirmed: body.totalCreditsConfirmed,
        summaryZh: body.summaryZh,
        summaryEn: body.summaryEn,
      },
    })
    for (const category of body.categories ?? []) {
      await prisma.creditCategory.update({
        where: { id: category.id },
        data: {
          requiredCredits: category.requiredCredits,
          isPlaceholder: category.isPlaceholder,
          noteZh: category.noteZh,
          noteEn: category.noteEn,
        },
      })
    }
    await audit({
      actorId: req.userId,
      action: 'rules.update',
      entityType: 'ruleSet',
      entityId: before.id,
      summaryZh: `更新 ${cohortYear} 入學年度畢業規則`,
      summaryEn: `Updated graduation rules for cohort ${cohortYear}`,
      before: { totalCredits: before.totalCredits, totalCreditsConfirmed: before.totalCreditsConfirmed },
      after: body,
    })
    res.json({ ok: true })
  }),
)

const conditionSchema = z.object({
  nameZh: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().max(120),
  descriptionZh: z.string().trim().min(1).max(1500),
  descriptionEn: z.string().trim().max(1500),
  kind: z.enum(['NON_CREDIT', 'OPTIONAL', 'INFO']),
}).transform((body) => ({ ...body, nameEn: body.nameEn || body.nameZh, descriptionEn: body.descriptionEn || body.descriptionZh }))

router.post(
  '/rules/:cohort/conditions',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = conditionSchema.parse(req.body)
    const cohortYear = Number(req.params.cohort)
    if (!Number.isInteger(cohortYear)) throw new HttpError(400, 'VALIDATION')
    const rule = await prisma.ruleSet.findUnique({ where: { cohortYear } })
    if (!rule) throw new HttpError(404, 'NOT_FOUND')
    const condition = await prisma.$transaction(async (tx) => {
      const { _max } = await tx.threshold.aggregate({ where: { ruleSetId: rule.id }, _max: { sort: true } })
      const created = await tx.threshold.create({
        data: { ...body, code: `CUSTOM_${randomUUID()}`, ruleSetId: rule.id, sort: (_max.sort ?? 0) + 1 },
      })
      await audit({
        actorId: req.userId, action: 'rules.condition.create', entityType: 'threshold', entityId: created.id,
        summaryZh: `新增 ${cohortYear} 入學年度畢業條件：${created.nameZh}`,
        summaryEn: `Added graduation condition for cohort ${cohortYear}: ${created.nameEn}`,
        after: body,
      }, tx)
      return created
    })
    res.status(201).json({ condition })
  }),
)

router.patch(
  '/rules/:cohort/conditions/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = conditionSchema.parse(req.body)
    const cohortYear = Number(req.params.cohort)
    if (!Number.isInteger(cohortYear)) throw new HttpError(400, 'VALIDATION')
    const condition = await prisma.$transaction(async (tx) => {
      const before = await tx.threshold.findFirst({ where: { id: pid(req.params.id), ruleSet: { cohortYear } } })
      if (!before) throw new HttpError(404, 'NOT_FOUND')
      const updated = await tx.threshold.update({ where: { id: before.id }, data: { ...body, isPlaceholder: false } })
      await audit({
        actorId: req.userId, action: 'rules.condition.update', entityType: 'threshold', entityId: updated.id,
        summaryZh: `更新 ${cohortYear} 入學年度畢業條件：${updated.nameZh}`,
        summaryEn: `Updated graduation condition for cohort ${cohortYear}: ${updated.nameEn}`,
        before,
        after: { ...body, isPlaceholder: false },
      }, tx)
      return updated
    })
    res.json({ condition })
  }),
)

router.get(
  '/recognized',
  asyncHandler(async (_req, res) => {
    const items = await prisma.recognizedItem.findMany({ orderBy: [{ type: 'asc' }, { nameZh: 'asc' }] })
    res.json({ items })
  }),
)

router.post(
  '/recognized',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = recognizedSchema.parse(req.body)
    const item = await prisma.recognizedItem.create({
      data: {
        ...body,
        minScore: body.minScore ?? null,
        scoreLabelZh: body.scoreLabelZh ?? '',
        scoreLabelEn: body.scoreLabelEn ?? '',
        sourceUrl: body.sourceUrl ?? '',
        noteZh: body.noteZh ?? '',
        noteEn: body.noteEn ?? '',
      },
    })
    await audit({
      actorId: req.userId,
      action: 'recognized.create',
      entityType: 'recognized',
      entityId: item.id,
      summaryZh: `新增認可項目 ${item.nameZh}`,
      summaryEn: `Added recognized item ${item.nameEn}`,
    })
    res.status(201).json(item)
  }),
)

router.patch(
  '/recognized/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = recognizedSchema.partial().parse(req.body)
    const before = await prisma.recognizedItem.findUnique({ where: { id: pid(req.params.id) } })
    if (!before) throw new HttpError(404, 'NOT_FOUND')
    const item = await prisma.recognizedItem.update({ where: { id: before.id }, data: body })
    await audit({
      actorId: req.userId,
      action: 'recognized.update',
      entityType: 'recognized',
      entityId: item.id,
      summaryZh: `更新認可項目 ${item.nameZh}`,
      summaryEn: `Updated recognized item ${item.nameEn}`,
      before: { minScore: before.minScore, active: before.active, countsAsPass: before.countsAsPass },
      after: body,
    })
    res.json(item)
  }),
)

router.get(
  '/reviews',
  asyncHandler(async (_req, res) => {
    const submissions = await prisma.submission.findMany({
      where: { status: 'PENDING' },
      include: { files: true, threshold: true, recognizedItem: true, student: { select: { id: true, account: true, nameZh: true, nameEn: true } } },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ submissions: submissions.map(presentSubmission) })
  }),
)

router.post(
  '/reviews/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({ decision: z.enum(['APPROVED', 'REJECTED']), comment: z.string().trim().max(1000).optional() })
      .parse(req.body)
    const submission = await prisma.submission.findUnique({ where: { id: pid(req.params.id) }, include: { threshold: true } })
    if (!submission) throw new HttpError(404, 'NOT_FOUND')
    await prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: body.decision,
        reviewComment: body.comment || null,
        reviewerId: req.userId,
        reviewedAt: new Date(),
      },
    })
    await tellStudentReviewed(submission.studentId, body.decision === 'APPROVED', body.comment || '')
    await audit({
      actorId: req.userId,
      action: 'submission.review',
      entityType: 'submission',
      entityId: submission.id,
      summaryZh: `${body.decision === 'APPROVED' ? '核可' : '退回'} ${submission.threshold.nameZh}`,
      summaryEn: `${body.decision === 'APPROVED' ? 'Approved' : 'Rejected'} ${submission.threshold.nameEn}`,
      before: { status: submission.status },
      after: { status: body.decision },
    })
    res.json({ ok: true })
  }),
)

router.post(
  '/credits',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = creditSchema.parse(req.body)
    const checked = inspectCredits(
      [
        {
          account: body.account,
          courseNameZh: body.courseNameZh,
          courseNameEn: body.courseNameEn ?? '',
          categoryCode: body.categoryCode,
          credits: String(body.credits),
          grade: body.grade ?? '',
          termYear: String(body.termYear),
          termSemester: String(body.termSemester),
          domain: body.domain ?? '',
          passed: body.passed ? 'true' : 'false',
        },
      ],
      await loadCreditContext(),
    )
    if (checked[0]?.status === 'error') {
      throw new HttpError(400, 'VALIDATION', {
        zh: checked[0].errors.map((item) => item.zh).join('；'),
        en: checked[0].errors.map((item) => item.en).join('; '),
      })
    }
    const student = await prisma.user.findFirst({ where: { account: body.account, role: 'STUDENT' } })
    if (!student) throw new HttpError(404, 'NOT_FOUND')
    const record = await prisma.creditRecord.create({
      data: {
        studentId: student.id,
        courseNameZh: body.courseNameZh,
        courseNameEn: body.courseNameEn || body.courseNameZh,
        categoryCode: body.categoryCode,
        credits: body.credits,
        grade: body.grade,
        termYear: body.termYear,
        termSemester: body.termSemester,
        domain: body.domain,
        passed: body.passed,
      },
    })
    await audit({
      actorId: req.userId,
      action: 'credit.create',
      entityType: 'credit',
      entityId: record.id,
      summaryZh: `登打 ${student.account} ${body.courseNameZh} ${body.credits} 學分`,
      summaryEn: `Entered ${body.credits} credits for ${student.account}`,
    })
    res.status(201).json({ id: record.id })
  }),
)

router.post(
  '/credits/import',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({ csv: z.string().min(1).max(500_000), confirm: z.literal(true).optional(), conflict: z.enum(['skip', 'update']).optional() })
      .parse(req.body)
    const built = await buildPreview(req.userId!, 'credits', Buffer.from(body.csv, 'utf8'))
    if (body.confirm !== true) return res.json(previewBody(built))
    const result = await commitPreview(req.userId!, built.id, body.conflict ?? 'skip')
    if (!result) throw new HttpError(404, 'PREVIEW_EXPIRED')
    res.json(result)
  }),
)

router.post(
  '/preaudit',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ cohortYear: z.number().int() }).parse(req.body)
    const run = await runPreaudit(body.cohortYear, req.userId!)
    res.json(run)
  }),
)

router.get(
  '/preaudit',
  asyncHandler(async (_req, res) => {
    const runs = await prisma.preAuditRun.findMany({ orderBy: { runAt: 'desc' }, take: 20 })
    res.json({ runs })
  }),
)

router.post(
  '/reminders',
  asyncHandler(async (_req, res) => {
    res.json(await runReminders())
  }),
)

router.get(
  '/retention',
  asyncHandler(async (_req, res) => {
    const policy = await prisma.retentionPolicy.findUnique({ where: { id: 1 } })
    const preview = await retentionCandidates()
    res.json({ retentionYears: policy?.retentionYears ?? 5, preview })
  }),
)

router.put(
  '/retention',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ retentionYears: z.number().int().min(1).max(30) }).parse(req.body)
    const before = await prisma.retentionPolicy.findUnique({ where: { id: 1 } })
    await prisma.retentionPolicy.upsert({
      where: { id: 1 },
      update: { retentionYears: body.retentionYears },
      create: { id: 1, retentionYears: body.retentionYears },
    })
    await audit({
      actorId: req.userId,
      action: 'retention.update',
      entityType: 'retention',
      entityId: 'policy',
      summaryZh: `保存年限改為 ${body.retentionYears} 年`,
      summaryEn: `Retention period set to ${body.retentionYears} years`,
      before: { years: before?.retentionYears },
      after: body,
    })
    res.json({ ok: true })
  }),
)

router.post(
  '/retention/purge',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ confirm: z.literal('PURGE') }).parse(req.body)
    void body
    res.json(await purgeRetention(req.userId ?? null))
  }),
)

router.post(
  '/users/:id/anonymize',
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await anonymizeUser(pid(req.params.id), req.userId ?? null)
    if (!result) throw new HttpError(404, 'NOT_FOUND')
    res.json(result)
  }),
)

const announcementDraft = z.object({
  audience: z.enum(['ALL', 'STUDENT', 'TEACHER']),
  titleZh: z.string().trim().min(1).max(120),
  bodyZh: z.string().trim().min(1).max(4000),
  titleEn: z.string().trim().max(120).optional(),
  bodyEn: z.string().trim().max(4000).optional(),
})
const announcementRecord = announcementDraft.extend({ recipientCount: z.number().int().positive() })
const announcementAction = 'announcement.publish'

router.get(
  '/announcements',
  asyncHandler(async (_req, res) => {
    const entries = await prisma.auditLog.findMany({
      where: { action: announcementAction },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: { id: true, createdAt: true, after: true },
    })
    res.json({ announcements: entries.flatMap((entry) => {
      const record = announcementRecord.safeParse(entry.after)
      return record.success ? [{ id: entry.id, createdAt: entry.createdAt, ...record.data }] : []
    }) })
  }),
)

router.post(
  '/announcements',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { requestId, audience, titleZh, bodyZh, titleEn, bodyEn } = announcementDraft.extend({ requestId: z.string().uuid() }).parse(req.body)
    const content = { titleZh, bodyZh, titleEn: titleEn || titleZh, bodyEn: bodyEn || bodyZh }
    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.auditLog.findUnique({ where: { id: requestId } })
      if (previous) {
        const record = announcementRecord.safeParse(previous.after)
        if (previous.actorId !== req.userId || previous.action !== announcementAction || !record.success ||
          record.data.audience !== audience || record.data.titleZh !== content.titleZh || record.data.titleEn !== content.titleEn ||
          record.data.bodyZh !== content.bodyZh || record.data.bodyEn !== content.bodyEn) {
          throw new HttpError(409, 'VALIDATION')
        }
        return { id: previous.id, createdAt: previous.createdAt, ...record.data }
      }
      const recipients = await tx.user.findMany({
        where: { status: 'ACTIVE', anonymizedAt: null, role: audience === 'ALL' ? { in: ['STUDENT', 'TEACHER'] } : audience },
        select: { id: true },
      })
      if (!recipients.length) throw new HttpError(400, 'NO_ANNOUNCEMENT_RECIPIENTS', {
        zh: '這個對象目前沒有可接收公告的帳號。', en: 'There are no active recipients in this audience.',
      })
      const record = { audience, recipientCount: recipients.length, ...content }
      const entry = await tx.auditLog.create({
        data: {
          id: requestId, actorId: req.userId, action: announcementAction, entityType: 'announcement', entityId: requestId,
          summaryZh: `發布公告：${titleZh}`, summaryEn: `Published announcement: ${content.titleEn}`, after: record,
        },
      })
      // The history entry and every inbox copy are committed together.
      for (let offset = 0; offset < recipients.length; offset += 1000) {
        await tx.notification.createMany({
          data: recipients.slice(offset, offset + 1000).map(({ id }) => ({
            userId: id, kind: 'announcement', ...content, createdAt: entry.createdAt,
          })),
        })
      }
      return { id: entry.id, createdAt: entry.createdAt, ...record }
    }, { timeout: 30_000 })
    res.status(201).json({ announcement: result })
  }),
)

router.get(
  '/audit',
  asyncHandler(async (_req, res) => {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actor: { select: { account: true, nameZh: true } } },
    })
    res.json({ logs })
  }),
)

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.appSetting.findMany()
    res.json({ settings: Object.fromEntries(rows.map((row) => [row.key, row.value])) })
  }),
)

router.put(
  '/settings',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        academicYear: z.number().int(),
        semester: z.number().int().min(1).max(2),
        preauditMonth: z.number().int().min(1).max(12),
        preauditDay: z.number().int().min(1).max(28),
      })
      .parse(req.body)
    for (const [key, value] of Object.entries(body)) {
      await prisma.appSetting.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } })
    }
    await audit({
      actorId: req.userId,
      action: 'settings.update',
      entityType: 'settings',
      entityId: 'calendar',
      summaryZh: '更新學年與預審日',
      summaryEn: 'Updated calendar and pre-audit date',
      after: body,
    })
    res.json({ ok: true })
  }),
)

const recognizedSchema = z.object({
  type: z.enum(['ENGLISH', 'CERTIFICATION', 'COMPETITION']),
  nameZh: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(160),
  minScore: z.number().nullable().optional(),
  scoreLabelZh: z.string().max(40).optional(),
  scoreLabelEn: z.string().max(40).optional(),
  countsAsPass: z.boolean().optional(),
  active: z.boolean().optional(),
  sourceUrl: z.string().max(300).optional(),
  noteZh: z.string().max(500).optional(),
  noteEn: z.string().max(500).optional(),
})

const creditSchema = z.object({
  account: accountSchema,
  courseNameZh: z.string().trim().min(1).max(80),
  courseNameEn: z.string().max(120).optional(),
  categoryCode: z.string().trim().min(1).max(40),
  credits: z.number().positive().max(30),
  grade: z.string().max(20).optional(),
  termYear: z.number().int(),
  termSemester: z.number().int().min(1).max(2),
  domain: z.string().max(40).optional(),
  passed: z.boolean().default(true),
})

export default router
