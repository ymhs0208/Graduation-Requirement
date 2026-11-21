import { Router } from 'express'
import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import { z } from 'zod'
import { prisma } from '../db'
import { audit } from '../audit'
import { hashPassword } from '../crypto'
import { HttpError } from '../errors'
import { asyncHandler, pid, requireRole, requireUser, type AuthedRequest } from '../http'
import { anonymizeUser, purgeRetention, retentionCandidates, runPreaudit, runReminders } from '../jobs'
import { progressFor } from '../progress'
import { issueActivation, schoolEmail } from './auth'
import { presentSubmission, tellStudentReviewed } from './student'

const router = Router()
router.use(requireUser, requireRole('ADMIN'))

const accountSchema = z.string().trim().regex(/^[A-Za-z0-9]{4,20}$/)

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
        email: schoolEmail,
        role: z.enum(['STUDENT', 'TEACHER', 'ADMIN']),
        cohortYear: z.number().int().min(100).max(200).optional(),
        classId: z.string().optional(),
      })
      .parse(req.body)
    if (body.role === 'STUDENT' && !body.cohortYear) throw new HttpError(400, 'VALIDATION')
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
    const body = z.object({ csv: z.string().min(1).max(500_000) }).parse(req.body)
    const rows = parse(body.csv.replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[]
    const created = []
    for (const row of rows) {
      const account = accountSchema.parse(row.account)
      const email = schoolEmail.parse(row.email)
      const role = z.enum(['STUDENT', 'TEACHER', 'ADMIN']).parse(row.role || 'STUDENT')
      const cohortYear = row.cohortYear ? Number(row.cohortYear) : undefined
      let classId: string | null = null
      if (row.className) {
        const year = cohortYear ?? new Date().getFullYear() - 1911
        const found = await prisma.class.upsert({
          where: { nameZh_cohortYear: { nameZh: row.className, cohortYear: year } },
          update: {},
          create: { nameZh: row.className, nameEn: row.classNameEn || row.className, cohortYear: year },
        })
        classId = found.id
      }
      const user = await prisma.user.create({
        data: {
          account,
          email: email.toLowerCase(),
          nameZh: z.string().min(1).max(40).parse(row.nameZh),
          nameEn: (row.nameEn || row.nameZh).slice(0, 80),
          role,
          cohortYear: cohortYear ?? null,
          classId,
          passwordHash: await hashPassword('Temp#pending1'),
          mustChangePassword: true,
        },
      })
      const issued = await issueActivation(user.id)
      created.push({ account, tempPassword: issued?.tempPassword })
    }
    await audit({
      actorId: req.userId,
      action: 'user.import',
      entityType: 'user',
      summaryZh: `匯入 ${created.length} 個帳號`,
      summaryEn: `Imported ${created.length} accounts`,
    })
    res.json({ created })
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
    const body = z.object({ csv: z.string().min(1).max(500_000) }).parse(req.body)
    const rows = parse(body.csv.replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[]
    let count = 0
    for (const row of rows) {
      const student = await prisma.user.findFirst({ where: { account: row.account, role: 'STUDENT' } })
      if (!student) throw new HttpError(400, 'VALIDATION')
      await prisma.creditRecord.create({
        data: {
          studentId: student.id,
          courseNameZh: row.courseNameZh,
          courseNameEn: row.courseNameEn || row.courseNameZh,
          categoryCode: row.categoryCode,
          credits: Number(row.credits),
          grade: row.grade || null,
          termYear: Number(row.termYear),
          termSemester: Number(row.termSemester),
          domain: row.domain || null,
          passed: row.passed !== 'false',
        },
      })
      count += 1
    }
    await audit({
      actorId: req.userId,
      action: 'credit.import',
      entityType: 'credit',
      summaryZh: `匯入 ${count} 筆成績`,
      summaryEn: `Imported ${count} credit records`,
    })
    res.json({ count })
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
