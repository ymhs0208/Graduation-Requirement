import { randomBytes } from 'crypto'
import { prisma } from './db'
import { audit } from './audit'
import { HttpError } from './errors'
import { issueActivation } from './routes/auth'
import {
  countRows,
  decodeCsv,
  errorReportCsv,
  inspectAccounts,
  inspectCredits,
  parseCsv,
  templateCsv,
  type ImportKind,
  type ImportRow,
} from './csv-import'

export type StoredPreview = {
  id: string
  actorId: string
  kind: ImportKind
  encoding: 'utf-8' | 'big5'
  rows: ImportRow[]
  createdAt: number
  used: boolean
}

const previews = new Map<string, StoredPreview>()
const PREVIEW_MS = 30 * 60 * 1000

function sweep() {
  const now = Date.now()
  for (const [id, preview] of previews) {
    if (now - preview.createdAt > PREVIEW_MS) previews.delete(id)
  }
}

export function rememberPreview(preview: StoredPreview) {
  sweep()
  previews.set(preview.id, preview)
}

export function readPreview(id: string, actorId: string) {
  sweep()
  const preview = previews.get(id)
  if (!preview || preview.actorId !== actorId) return null
  return preview
}

export async function loadAccountContext() {
  const [classes, users, rules] = await Promise.all([
    prisma.class.findMany({ select: { id: true, nameZh: true, nameEn: true, cohortYear: true } }),
    prisma.user.findMany({ select: { account: true } }),
    prisma.ruleSet.findMany({ select: { cohortYear: true } }),
  ])
  return {
    classes,
    accounts: new Set(users.map((item) => item.account)),
    cohorts: new Set(rules.map((item) => item.cohortYear)),
  }
}

export async function loadCreditContext() {
  const [students, courses, categories, existing] = await Promise.all([
    prisma.user.findMany({ where: { role: 'STUDENT' }, select: { id: true, account: true, cohortYear: true } }),
    prisma.planItem.findMany({ select: { nameZh: true, nameEn: true, requirementType: true, ruleSet: { select: { cohortYear: true } } } }),
    prisma.creditCategory.findMany({ select: { code: true, ruleSet: { select: { cohortYear: true } } } }),
    prisma.creditRecord.findMany({ select: { id: true, courseNameZh: true, termYear: true, termSemester: true, student: { select: { account: true } } } }),
  ])
  return {
    students,
    courses: courses.map((item) => ({ cohortYear: item.ruleSet.cohortYear, nameZh: item.nameZh, nameEn: item.nameEn, requirementType: item.requirementType })),
    categories: categories.map((item) => ({ cohortYear: item.ruleSet.cohortYear, code: item.code })),
    existing: existing.map((item) => ({ id: item.id, account: item.student.account, courseNameZh: item.courseNameZh, termYear: item.termYear, termSemester: item.termSemester })),
  }
}

export async function buildPreview(actorId: string, kind: ImportKind, buf: Buffer) {
  const decoded = decodeCsv(buf)
  let records: Record<string, string>[]
  try {
    records = parseCsv(decoded.text)
  } catch {
    throw new HttpError(400, 'CSV_PARSE')
  }
  if (!records.length) throw new HttpError(400, 'CSV_EMPTY')
  const rows = kind === 'accounts' ? inspectAccounts(records, await loadAccountContext()) : inspectCredits(records, await loadCreditContext())
  const preview: StoredPreview = {
    id: randomBytes(16).toString('hex'),
    actorId,
    kind,
    encoding: decoded.encoding,
    rows,
    createdAt: Date.now(),
    used: false,
  }
  rememberPreview(preview)
  return preview
}

export function previewBody(preview: StoredPreview) {
  return {
    previewId: preview.id,
    kind: preview.kind,
    encoding: preview.encoding,
    counts: countRows(preview.rows),
    rows: preview.rows.map((row) => ({
      line: row.line,
      status: row.status,
      errors: row.errors,
      fields: row.fields,
    })),
  }
}

export function templateBody(kind: ImportKind) {
  return `\uFEFF${templateCsv(kind)}`
}

export function errorsBody(preview: StoredPreview) {
  return `\uFEFF${errorReportCsv(preview.rows)}`
}

export async function commitPreview(actorId: string, previewId: string, conflict: 'skip' | 'update') {
  const preview = readPreview(previewId, actorId)
  if (!preview || preview.used) return null
  preview.used = true
  try {
    const result = await prisma.$transaction(async (tx) => {
      let committed = 0
      let updated = 0
      let skipped = 0
      const createdIds: string[] = []
      if (preview.kind === 'accounts') {
        for (const row of preview.rows) {
          if (!row.account || (row.status !== 'valid' && row.status !== 'conflict')) continue
          const current = await tx.user.findUnique({ where: { account: row.account.account } })
          if (current && conflict === 'skip') {
            skipped += 1
            continue
          }
          if (current && conflict === 'update') {
            await tx.user.update({
              where: { id: current.id },
              data: {
                nameZh: row.account.nameZh,
                nameEn: row.account.nameEn,
                email: row.account.email,
                role: row.account.role,
                cohortYear: row.account.cohortYear,
                classId: row.account.classId,
              },
            })
            updated += 1
            continue
          }
          if (current) {
            skipped += 1
            continue
          }
          const created = await tx.user.create({
            data: {
              account: row.account.account,
              nameZh: row.account.nameZh,
              nameEn: row.account.nameEn,
              email: row.account.email,
              role: row.account.role,
              cohortYear: row.account.cohortYear,
              classId: row.account.classId,
              passwordHash: 'pending',
              mustChangePassword: true,
            },
          })
          createdIds.push(created.id)
          committed += 1
        }
      } else {
        for (const row of preview.rows) {
          if (!row.credit || (row.status !== 'valid' && row.status !== 'conflict')) continue
          const current = await tx.creditRecord.findFirst({
            where: {
              student: { account: row.credit.account },
              courseNameZh: row.credit.courseNameZh,
              termYear: row.credit.termYear,
              termSemester: row.credit.termSemester,
            },
          })
          if (current && conflict === 'skip') {
            skipped += 1
            continue
          }
          if (current && conflict === 'update') {
            await tx.creditRecord.update({
              where: { id: current.id },
              data: {
                courseNameEn: row.credit.courseNameEn,
                categoryCode: row.credit.categoryCode,
                credits: row.credit.credits,
                grade: row.credit.grade,
                domain: row.credit.domain,
                passed: row.credit.passed,
              },
            })
            updated += 1
            continue
          }
          if (current) {
            skipped += 1
            continue
          }
          await tx.creditRecord.create({
            data: {
              studentId: row.credit.studentId,
              courseNameZh: row.credit.courseNameZh,
              courseNameEn: row.credit.courseNameEn,
              categoryCode: row.credit.categoryCode,
              credits: row.credit.credits,
              grade: row.credit.grade,
              termYear: row.credit.termYear,
              termSemester: row.credit.termSemester,
              domain: row.credit.domain,
              passed: row.credit.passed,
            },
          })
          committed += 1
        }
      }
      return { committed, updated, skipped, createdIds }
    })
    const activations = []
    for (const id of result.createdIds) {
      const issued = await issueActivation(id).catch(() => null)
      if (issued) activations.push(issued)
    }
    await audit({
      actorId,
      action: preview.kind === 'accounts' ? 'user.import' : 'credit.import',
      entityType: preview.kind === 'accounts' ? 'user' : 'credit',
      summaryZh: `匯入${preview.kind === 'accounts' ? '帳號' : '學分'}：新增 ${result.committed}、更新 ${result.updated}、略過 ${result.skipped}`,
      summaryEn: `Imported ${preview.kind}: created ${result.committed}, updated ${result.updated}, skipped ${result.skipped}`,
      after: { committed: result.committed, updated: result.updated, skipped: result.skipped, conflict },
    })
    previews.delete(preview.id)
    return { committed: result.committed, updated: result.updated, skipped: result.skipped, activations }
  } catch (error) {
    preview.used = false
    throw error
  }
}
