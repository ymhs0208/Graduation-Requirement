import { Router } from 'express'
import { z } from 'zod'
import { audit } from '../audit'
import { prisma } from '../db'
import { HttpError } from '../errors'
import { asyncHandler, pid } from '../http'

const router = Router()

const planCourse = z.object({
  studyYear: z.number().int().min(0).max(4),
  term: z.enum(['YEAR_ONLY', 'FULL_YEAR', 'FIRST', 'SECOND', 'PROGRAM']),
  nameZh: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160),
  moduleZh: z.string().trim().min(1).max(120),
  moduleEn: z.string().trim().max(120),
  requirementType: z.enum(['MAJOR_REQUIRED', 'MAJOR_ELECTIVE', 'LIBERAL']),
  credits: z.number().nonnegative().nullable(),
  classHours: z.number().int().min(0).max(2147483647).nullable(),
  practiceHours: z.number().int().min(0).max(2147483647).nullable(),
  noteZh: z.string().trim().max(500),
  noteEn: z.string().trim().max(500),
}).refine((body) => (body.studyYear === 0) === (body.term === 'PROGRAM'))
  .transform((body) => ({
    ...body,
    nameEn: body.nameEn || body.nameZh,
    moduleEn: body.moduleEn || body.moduleZh,
    noteEn: body.noteEn || body.noteZh,
    creditsConfirmed: body.credits !== null,
  }))

async function ruleFor(value: string | string[] | undefined) {
  const cohortYear = Number(pid(value))
  if (!Number.isInteger(cohortYear)) throw new HttpError(400, 'VALIDATION')
  const rule = await prisma.ruleSet.findUnique({ where: { cohortYear }, select: { id: true, cohortYear: true } })
  if (!rule) throw new HttpError(404, 'NOT_FOUND')
  return rule
}

router.get('/', asyncHandler(async (_req, res) => {
  const cohorts = await prisma.ruleSet.findMany({
    select: { cohortYear: true, _count: { select: { planItems: true } } },
    orderBy: { cohortYear: 'desc' },
  })
  res.json({ cohorts: cohorts.map((item) => ({ cohortYear: item.cohortYear, courseCount: item._count.planItems })) })
}))

router.get('/:cohort', asyncHandler(async (req, res) => {
  const rule = await ruleFor(req.params.cohort)
  const items = await prisma.planItem.findMany({ where: { ruleSetId: rule.id }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] })
  res.json({ items })
}))

router.post('/:cohort', asyncHandler(async (req, res) => {
  const rule = await ruleFor(req.params.cohort)
  const data = planCourse.parse(req.body)
  const item = await prisma.$transaction(async (tx) => {
    const { _max } = await tx.planItem.aggregate({ where: { ruleSetId: rule.id }, _max: { sort: true } })
    const created = await tx.planItem.create({
      data: { ...data, ruleSetId: rule.id, sort: (_max.sort ?? 0) + 1, sourceNoteZh: '', sourceNoteEn: '' },
    })
    await audit({
      actorId: req.userId, action: 'plan.course.create', entityType: 'planItem', entityId: created.id,
      summaryZh: `新增 ${rule.cohortYear} 入學年度課程：${created.nameZh}`,
      summaryEn: `Added course for cohort ${rule.cohortYear}: ${created.nameEn}`, after: data,
    }, tx)
    return created
  })
  res.status(201).json({ item })
}))

router.patch('/:cohort/:id', asyncHandler(async (req, res) => {
  const rule = await ruleFor(req.params.cohort)
  const data = planCourse.parse(req.body)
  const item = await prisma.$transaction(async (tx) => {
    const before = await tx.planItem.findFirst({ where: { id: pid(req.params.id), ruleSetId: rule.id } })
    if (!before) throw new HttpError(404, 'NOT_FOUND')
    const updated = await tx.planItem.update({ where: { id: before.id }, data })
    await audit({
      actorId: req.userId, action: 'plan.course.update', entityType: 'planItem', entityId: updated.id,
      summaryZh: `更新 ${rule.cohortYear} 入學年度課程：${updated.nameZh}`,
      summaryEn: `Updated course for cohort ${rule.cohortYear}: ${updated.nameEn}`, before, after: data,
    }, tx)
    return updated
  })
  res.json({ item })
}))

router.delete('/:cohort/:id', asyncHandler(async (req, res) => {
  const rule = await ruleFor(req.params.cohort)
  await prisma.$transaction(async (tx) => {
    const item = await tx.planItem.findFirst({ where: { id: pid(req.params.id), ruleSetId: rule.id } })
    if (!item) throw new HttpError(404, 'NOT_FOUND')
    await tx.planItem.delete({ where: { id: item.id } })
    await audit({
      actorId: req.userId, action: 'plan.course.remove', entityType: 'planItem', entityId: item.id,
      summaryZh: `移除 ${rule.cohortYear} 入學年度課程：${item.nameZh}`,
      summaryEn: `Removed course from the plan for cohort ${rule.cohortYear}: ${item.nameEn}`, before: item,
    }, tx)
  })
  res.json({ ok: true })
}))

export default router
