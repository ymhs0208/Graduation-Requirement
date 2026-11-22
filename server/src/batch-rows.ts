import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import type { BatchKind, CsvRow } from './batch-csv'
import { HttpError } from './errors'
import { planCourse } from './plan-course'

type Db = Prisma.TransactionClient
export type Change = { field: string; before: string; after: string }
type PlannedRow = {
  key: string; label: string; status: 'new' | 'update' | 'skip'
  changes?: Change[]; identity?: unknown; credits?: { type: string; amount: number }
  apply?: (db: Db) => Promise<string>
}
export type BatchRow = { line: number } & (PlannedRow | { label: string; status: 'error' | 'duplicate'; messageZh: string; messageEn: string })

class RowProblem extends Error {
  constructor(readonly zh: string, readonly en: string) { super(en) }
}

function requireRow<T>(value: T, zh: string, en: string): asserts value {
  if (!value) throw new RowProblem(zh, en)
}

function rowsFor(rows: CsvRow[], inspect: (fields: CsvRow['fields']) => PlannedRow): BatchRow[] {
  return rows.map(({ line, fields }) => {
    try {
      return { line, ...inspect(fields) }
    } catch (error) {
      if (!(error instanceof RowProblem)) throw error
      const label = fields.nameZh || fields.studentAccount || fields.className || fields.advisorAccount || ''
      return { line, label, status: 'error', messageZh: error.zh, messageEn: error.en }
    }
  })
}

function flagDuplicates(rows: BatchRow[]): BatchRow[] {
  const counts = new Map<string, number>()
  for (const row of rows) if ('key' in row) counts.set(row.key, (counts.get(row.key) ?? 0) + 1)
  return rows.map((row) => 'key' in row && (counts.get(row.key) ?? 0) > 1
    ? { line: row.line, label: row.label, status: 'duplicate', messageZh: '同一筆資料在檔案中出現多次。', messageEn: 'This record appears more than once in the file.' }
    : row)
}

const tuple = (...values: unknown[]) => JSON.stringify(values)
const normalized = (value: string) => value.normalize('NFC').toLowerCase()
const stringValue = (value: unknown) => value == null ? '' : String(value)

function changesBetween(before: object | undefined, after: object, labels: Record<string, string>) {
  const old = (before ?? {}) as Record<string, unknown>
  const current = after as Record<string, unknown>
  return Object.entries(labels).flatMap(([key, field]) => {
    const previous = stringValue(old[key])
    const next = stringValue(current[key])
    return previous === next ? [] : [{ field, before: previous, after: next }]
  })
}

function numberIn(raw: string | undefined, field: string, integer = false): number | null {
  if (!raw) return null
  const value = Number(raw)
  requireRow(/^\d+(?:\.\d+)?$/.test(raw) && Number.isFinite(value) && (!integer || Number.isInteger(value)),
    `${field}須填寫有效數字。`, `Enter a valid numeric value for ${field}.`)
  return value
}

const courseYears: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 一年級: '1', 二年級: '2', 三年級: '3', 四年級: '4', 修業期間: '0' }
const courseTerms: Record<string, string> = { 上: 'FIRST', 上學期: 'FIRST', 下: 'SECOND', 下學期: 'SECOND', 學年: 'FULL_YEAR', 全學年: 'FULL_YEAR', 全年: 'FULL_YEAR', 僅年級: 'YEAR_ONLY', 修業期間: 'PROGRAM' }
const courseTypes: Record<string, string> = { 必: 'MAJOR_REQUIRED', 必修: 'MAJOR_REQUIRED', 選: 'MAJOR_ELECTIVE', 選修: 'MAJOR_ELECTIVE', 博雅通識: 'LIBERAL' }
const courseFields = { studyYear: 'studyYear', term: 'term', nameZh: 'nameZh', nameEn: 'nameEn', moduleZh: 'moduleZh', moduleEn: 'moduleEn', requirementType: 'requirementType', credits: 'credits', classHours: 'classHours', practiceHours: 'practiceHours', noteZh: 'noteZh', noteEn: 'noteEn' }

async function courses(db: Db, rows: CsvRow[], cohort: number | undefined) {
  const rule = cohort === undefined ? null : await db.ruleSet.findUnique({ where: { cohortYear: cohort }, select: { id: true } })
  if (!rule) throw new HttpError(400, 'BAD_COHORT')
  const existing = await db.planItem.findMany({ where: { ruleSetId: rule.id } })
  let sort = Math.max(0, ...existing.map((item) => item.sort))
  const keyOf = (item: { studyYear: number; term: string; nameZh: string }) => tuple(item.studyYear, item.term, normalized(item.nameZh))
  return flagDuplicates(rowsFor(rows, (fields) => {
    const studyYear = numberIn(courseYears[fields.studyYear] ?? fields.studyYear, '年級', true)
    const term = courseTerms[fields.term] ?? fields.term?.toUpperCase()
    const requirementType = fields.moduleZh === '博雅通識' && ['選', '選修', 'MAJOR_ELECTIVE'].includes(fields.requirementType)
      ? 'LIBERAL' : courseTypes[fields.requirementType] ?? fields.requirementType?.toUpperCase()
    const credits = numberIn(fields.credits, '學分')
    requireRow(studyYear !== null && studyYear <= 4, '年級須填寫 1 到 4，修業期間填 0。', 'Use study year 1 through 4, or 0 for the whole program.')
    requireRow(credits !== null, '請填寫學分，零學分課程請填 0。', 'Enter the credits. Use 0 for a non-credit course.')
    requireRow(term && ['FIRST', 'SECOND', 'FULL_YEAR', 'YEAR_ONLY', 'PROGRAM'].includes(term) && (studyYear === 0) === (term === 'PROGRAM'),
      '學期和年級不符。可填上、下、學年、僅年級或修業期間。', 'The term does not match the study year. Use FIRST, SECOND, FULL_YEAR, YEAR_ONLY, or PROGRAM.')
    requireRow(['MAJOR_REQUIRED', 'MAJOR_ELECTIVE', 'LIBERAL'].includes(requirementType),
      '修別須填必修、選修或博雅通識。', 'Choose required, elective, or liberal education.')
    const key = keyOf({ studyYear, term, nameZh: fields.nameZh ?? '' })
    const matches = existing.filter((item) => keyOf(item) === key)
    requireRow(matches.length <= 1, '同一年級與學期已有多筆同名課程，請先在四年計畫設定整理。', 'Multiple courses with this name exist in the same term. Resolve them in the curriculum settings first.')
    const before = matches[0]
    const candidate = planCourse.safeParse({
      studyYear, term, requirementType, credits, nameZh: fields.nameZh, moduleZh: fields.moduleZh,
      nameEn: fields.nameEn || before?.nameEn || '', moduleEn: fields.moduleEn || before?.moduleEn || '',
      classHours: numberIn(fields.classHours, '上課時數', true) ?? before?.classHours ?? null,
      practiceHours: numberIn(fields.practiceHours, '實習時數', true) ?? before?.practiceHours ?? null,
      noteZh: fields.noteZh || before?.noteZh || '', noteEn: fields.noteEn || before?.noteEn || '',
    })
    requireRow(candidate.success, '請檢查科目、課程類別、時數或備註的格式與字數。', 'Check the course name, category, hours, and note format.')
    const data = candidate.data
    const changes = changesBetween(before, data, courseFields)
    const savedSort = ++sort
    return {
      key, label: fields.nameZh, identity: before?.id ?? null,
      status: before ? (changes.length ? 'update' : 'skip') : 'new', changes,
      credits: { type: data.requirementType, amount: credits * (term === 'FULL_YEAR' ? 2 : 1) },
      apply: async (tx) => (before
        ? await tx.planItem.update({ where: { id: before.id }, data })
        : await tx.planItem.create({ data: { ...data, ruleSetId: rule.id, sort: savedSort, sourceNoteZh: '', sourceNoteEn: '' } })).id,
    }
  }))
}

const classFields = z.object({ cohortYear: z.coerce.number().int().min(100).max(200), className: z.string().min(1).max(40), classNameEn: z.string().max(80) })
const accountValue = (value: string | undefined) => value?.toUpperCase() ?? ''

async function classes(db: Db, rows: CsvRow[]) {
  const accounts = [...new Set(rows.flatMap(({ fields }) => [accountValue(fields.advisorAccount), accountValue(fields.studentAccount)]).filter(Boolean))]
  const [users, existingClasses, rules] = await Promise.all([
    db.user.findMany({ where: { account: { in: accounts } }, select: { id: true, account: true, role: true, status: true, cohortYear: true, classId: true, class: { select: { nameZh: true } } } }),
    db.class.findMany({ select: { id: true, cohortYear: true, nameZh: true, advisorId: true, advisor: { select: { account: true } } } }),
    db.ruleSet.findMany({ select: { cohortYear: true } }),
  ])
  const userByAccount = new Map(users.map((user) => [user.account, user]))
  const classByKey = new Map(existingClasses.map((item) => [tuple(item.cohortYear, item.nameZh), item]))
  const cohorts = new Set(rules.map((rule) => rule.cohortYear))
  const advisorRows = rows.filter(({ fields }) => fields.advisorAccount || !fields.studentAccount)

  function base(fields: CsvRow['fields'], studentCohort?: number | null) {
    const parsed = classFields.safeParse({ ...fields, cohortYear: fields.cohortYear || studentCohort, classNameEn: fields.classNameEn ?? '' })
    requireRow(parsed.success && cohorts.has(parsed.data.cohortYear), '請填寫已建立規則的入學年度和有效班級名稱。', 'Enter a valid class name and a cohort with graduation rules.')
    return { ...parsed.data, target: tuple(parsed.data.cohortYear, parsed.data.className) }
  }

  const advisorPlans = flagDuplicates(rowsFor(advisorRows, (fields) => {
    const { cohortYear, className, classNameEn, target } = base(fields)
    requireRow(fields.advisorAccount && !fields.studentAccount, '每列請只填教師編號或學號其中一欄。', 'Fill in either a teacher ID or a student ID on each row.')
    const teacher = userByAccount.get(accountValue(fields.advisorAccount))
    requireRow(teacher?.role === 'TEACHER' && teacher.status === 'ACTIVE', '教師編號找不到啟用中的教師帳號。', 'The teacher ID does not match an active teacher.')
    const before = classByKey.get(target)
    return {
      key: target, label: `${cohortYear} · ${className}`, identity: before?.id ?? null,
      status: before?.advisorId === teacher.id ? 'skip' : before?.advisorId ? 'update' : 'new',
      changes: changesBetween({ advisorAccount: before?.advisor?.account }, { advisorAccount: teacher.account }, { advisorAccount: 'advisorAccount' }),
      apply: async (tx) => (before
        ? await tx.class.update({ where: { id: before.id }, data: { advisorId: teacher.id } })
        : await tx.class.create({ data: { cohortYear, nameZh: className, nameEn: classNameEn || className, advisorId: teacher.id } })).id,
    }
  }))
  const plannedClasses = new Set(advisorPlans.flatMap((row) => 'key' in row && row.status === 'new' ? [row.key] : []))
  const studentPlans = flagDuplicates(rowsFor(rows.filter(({ fields }) => fields.studentAccount && !fields.advisorAccount), (fields) => {
    const student = userByAccount.get(accountValue(fields.studentAccount))
    requireRow(student?.role === 'STUDENT' && student.status === 'ACTIVE', '學號找不到啟用中的學生帳號。', 'The student ID does not match an active student.')
    const { cohortYear, className, target } = base(fields, student.cohortYear)
    requireRow(student.cohortYear === cohortYear, '學生的入學年度與班級不符。', 'The class and student entry years must match.')
    const existing = classByKey.get(target)
    requireRow(existing || plannedClasses.has(target), '班級不存在，請先匯入對應的導師列。', 'The class does not exist. Include its advisor row in this import.')
    return {
      key: student.id, label: student.account, identity: [student.classId, existing?.id],
      status: existing && student.classId === existing.id ? 'skip' : student.classId ? 'update' : 'new',
      changes: changesBetween({ className: student.class?.nameZh }, { className }, { className: 'className' }),
      apply: async (tx) => {
        const id = existing?.id ?? (await tx.class.findUniqueOrThrow({ where: { nameZh_cohortYear: { nameZh: className, cohortYear } }, select: { id: true } })).id
        return (await tx.user.update({ where: { id: student.id }, data: { classId: id } })).id
      },
    }
  }))
  return [...advisorPlans, ...studentPlans]
}

const recognizedTypes: Record<string, string> = { 英文檢定: 'ENGLISH', 英文: 'ENGLISH', 證照: 'CERTIFICATION', 競賽: 'COMPETITION' }
const recognizedFields = { nameZh: 'nameZh', nameEn: 'nameEn', minScore: 'minScore', noteZh: 'noteZh', noteEn: 'noteEn' }
const recognizedData = z.object({
  type: z.enum(['ENGLISH', 'CERTIFICATION', 'COMPETITION']),
  nameZh: z.string().min(1).max(120), nameEn: z.string().min(1).max(160),
  minScore: z.number().nullable(), noteZh: z.string().max(500), noteEn: z.string().max(500),
})

async function recognized(db: Db, rows: CsvRow[]) {
  const existing = await db.recognizedItem.findMany()
  const keyOf = (item: { type: string; nameZh: string }) => tuple(item.type, normalized(item.nameZh))
  return flagDuplicates(rowsFor(rows, (fields) => {
    const type = recognizedTypes[fields.type] ?? fields.type?.toUpperCase()
    requireRow(type && ['ENGLISH', 'CERTIFICATION', 'COMPETITION'].includes(type),
      '類型須填英文檢定、證照或競賽。', 'Choose English test, certification, or competition.')
    const key = keyOf({ type, nameZh: fields.nameZh ?? '' })
    const matches = existing.filter((item) => keyOf(item) === key)
    requireRow(matches.length <= 1, '已有多筆同類型同名項目，請先整理認可清單。', 'Multiple items have the same type and name. Resolve them in the recognized list first.')
    const before = matches[0]
    const minScore = ['無', 'NONE'].includes(fields.minScore?.toUpperCase()) ? null : numberIn(fields.minScore, '最低分數') ?? before?.minScore ?? null
    const parsed = recognizedData.safeParse({
      type, nameZh: fields.nameZh, nameEn: fields.nameEn || before?.nameEn || fields.nameZh,
      minScore, noteZh: fields.noteZh || before?.noteZh || '', noteEn: fields.noteEn || before?.noteEn || fields.noteZh || '',
    })
    requireRow(parsed.success, '請檢查名稱及備註的格式與字數。', 'Check the name and note format.')
    const changes = changesBetween(before, parsed.data, recognizedFields)
    return {
      key, label: fields.nameZh, identity: before?.id ?? null,
      status: before ? (changes.length ? 'update' : 'skip') : 'new', changes,
      apply: async (tx) => (before
        ? await tx.recognizedItem.update({ where: { id: before.id }, data: parsed.data })
        : await tx.recognizedItem.create({ data: parsed.data })).id,
    }
  }))
}

const taipeiDay = (date: Date) => new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
function reviewDate(raw: string | undefined) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(raw ?? '')
  const clock = match?.[2] ?? '00:00:00'
  const date = new Date(match ? `${match[1]}T${clock.length === 5 ? clock + ':00' : clock}+08:00` : NaN)
  requireRow(match && Number.isFinite(date.getTime()) && taipeiDay(date) === match[1] && date.getTime() <= Date.now(),
    '原審核日期須為有效且已過的日期，格式為 YYYY-MM-DD，可加時分秒。', 'Enter a valid past review date as YYYY-MM-DD, optionally with a time.')
  return date
}

async function reviews(db: Db, rows: CsvRow[]) {
  const students = await db.user.findMany({
    where: { account: { in: [...new Set(rows.map(({ fields }) => accountValue(fields.studentAccount)))] }, role: 'STUDENT', anonymizedAt: null, cohortYear: { not: null } },
    select: { id: true, account: true, cohortYear: true },
  })
  const codes = [...new Set(rows.map(({ fields }) => accountValue(fields.thresholdCode)))]
  const [thresholds, existing] = await Promise.all([
    db.threshold.findMany({ where: { code: { in: codes }, isPlaceholder: false, kind: { not: 'INFO' }, ruleSet: { cohortYear: { in: students.flatMap(({ cohortYear }) => cohortYear == null ? [] : [cohortYear]) } } },
      select: { id: true, code: true, ruleSet: { select: { cohortYear: true } } } }),
    db.submission.findMany({ where: { studentId: { in: students.map((student) => student.id) }, reviewedAt: { not: null }, status: { in: ['APPROVED', 'REJECTED'] }, threshold: { code: { in: codes } } },
      select: { id: true, studentId: true, thresholdId: true, reviewedAt: true, status: true } }),
  ])
  const studentByAccount = new Map(students.map((student) => [student.account, student]))
  const thresholdByCode = new Map(thresholds.map((threshold) => [tuple(threshold.ruleSet.cohortYear, threshold.code), threshold.id]))
  const existingByKey = new Map(existing.flatMap((item) => item.reviewedAt ? [[tuple(item.studentId, item.thresholdId, taipeiDay(item.reviewedAt), item.status), item.id]] : []))
  return flagDuplicates(rowsFor(rows, (fields) => {
    const account = accountValue(fields.studentAccount)
    const student = studentByAccount.get(account)
    requireRow(student, '找不到符合學號且有入學年度的學生。', 'The student ID does not match a student with an entry year.')
    const thresholdCode = accountValue(fields.thresholdCode)
    const thresholdId = thresholdByCode.get(tuple(student.cohortYear, thresholdCode))
    requireRow(thresholdId, '找不到該生入學年度可審核的門檻代碼。', 'The threshold code does not match a reviewable requirement for this cohort.')
    const status = ['核可', '通過'].includes(fields.decision) ? 'APPROVED' : ['退回', '未通過'].includes(fields.decision) ? 'REJECTED' : fields.decision?.toUpperCase()
    requireRow(status === 'APPROVED' || status === 'REJECTED', '審核結果須填核可或退回。', 'Use APPROVED or REJECTED for the decision.')
    const reviewedAt = reviewDate(fields.reviewedAt)
    requireRow((fields.comment?.length ?? 0) <= 1000 && (fields.scoreText?.length ?? 0) <= 40,
      '分數或審核意見超過長度限制。', 'The score or review comment is too long.')
    const key = tuple(student.id, thresholdId, taipeiDay(reviewedAt), status)
    const existingId = existingByKey.get(key)
    return {
      key, label: `${account} · ${thresholdCode}`, identity: existingId ?? null,
      status: existingId ? 'skip' : 'new',
      changes: changesBetween(undefined, { decision: status, reviewedAt: fields.reviewedAt, scoreText: fields.scoreText, comment: fields.comment },
        { decision: 'decision', reviewedAt: 'reviewedAt', scoreText: 'scoreText', comment: 'comment' }),
      apply: async (tx) => (await tx.submission.create({
        data: { studentId: student.id, thresholdId, status, reviewedAt, createdAt: reviewedAt, scoreText: fields.scoreText || null, reviewComment: fields.comment || null },
        select: { id: true },
      })).id,
    }
  }))
}

export function inspectBatch(db: Db, kind: BatchKind, rows: CsvRow[], cohort?: number) {
  if (kind === 'courses') return courses(db, rows, cohort)
  if (kind === 'classes') return classes(db, rows)
  if (kind === 'recognized') return recognized(db, rows)
  return reviews(db, rows)
}
