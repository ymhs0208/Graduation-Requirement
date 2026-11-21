import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import iconv from 'iconv-lite'
import { importIssues } from './messages'

export type ImportKind = 'accounts' | 'credits'
export type CsvEncoding = 'utf-8' | 'big5'
export type RowStatus = 'valid' | 'error' | 'duplicate' | 'conflict'

export type ImportIssue = { code: string; zh: string; en: string }

export type AccountDraft = {
  account: string
  nameZh: string
  nameEn: string
  email: string
  role: 'STUDENT' | 'TEACHER' | 'ADMIN'
  cohortYear: number | null
  classId: string | null
}

export type CreditDraft = {
  account: string
  studentId: string
  courseNameZh: string
  courseNameEn: string
  categoryCode: string
  credits: number
  grade: string | null
  termYear: number
  termSemester: number
  domain: string | null
  passed: boolean
  existingId: string | null
}

export type ImportRow = {
  line: number
  status: RowStatus
  errors: ImportIssue[]
  fields: Record<string, string>
  account?: AccountDraft
  credit?: CreditDraft
}

export type ClassRef = { id: string; nameZh: string; nameEn: string; cohortYear: number }
export type PlanRef = { cohortYear: number; nameZh: string; nameEn: string; requirementType: string }
export type CreditRef = { id: string; account: string; courseNameZh: string; termYear: number; termSemester: number }
export type StudentRef = { id: string; account: string; cohortYear: number | null }

export type AccountContext = {
  classes: ClassRef[]
  accounts: Set<string>
  cohorts: Set<number>
}

export type CreditContext = {
  students: StudentRef[]
  courses: PlanRef[]
  categories: { cohortYear: number; code: string }[]
  existing: CreditRef[]
}

const aliases: Record<string, string> = {
  account: 'account',
  學號: 'account',
  帳號: 'account',
  教職員編號: 'account',
  namezh: 'nameZh',
  中文姓名: 'nameZh',
  姓名: 'nameZh',
  nameen: 'nameEn',
  英文姓名: 'nameEn',
  email: 'email',
  信箱: 'email',
  role: 'role',
  角色: 'role',
  cohortyear: 'cohortYear',
  入學年度: 'cohortYear',
  classname: 'className',
  班級: 'className',
  classnameen: 'classNameEn',
  班級英文: 'classNameEn',
  coursenamezh: 'courseNameZh',
  課程: 'courseNameZh',
  coursenameen: 'courseNameEn',
  課程英文: 'courseNameEn',
  categorycode: 'categoryCode',
  學分類別: 'categoryCode',
  credits: 'credits',
  學分: 'credits',
  grade: 'grade',
  成績: 'grade',
  termyear: 'termYear',
  學年: 'termYear',
  termsemester: 'termSemester',
  學期: 'termSemester',
  domain: 'domain',
  領域: 'domain',
  passed: 'passed',
  通過: 'passed',
}

export function decodeCsv(buf: Buffer): { text: string; encoding: CsvEncoding } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8' }
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.subarray(2).toString('utf16le').replace(/^\uFEFF/, ''), encoding: 'utf-8' }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '')
    return { text, encoding: 'utf-8' }
  } catch {
    return { text: iconv.decode(buf, 'big5').replace(/^\uFEFF/, ''), encoding: 'big5' }
  }
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows = parse(text.replace(/^\uFEFF/, ''), {
    columns: (headers: string[]) => headers.map((header) => aliases[header.replace(/^\uFEFF/, '').trim()] ?? aliases[header.replace(/^\uFEFF/, '').trim().toLowerCase()] ?? header.trim()),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[]
  return rows.map((row) => {
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) fields[key] = String(value ?? '').trim()
    return fields
  })
}

function issue(code: string): ImportIssue {
  const text = importIssues[code] ?? { zh: code, en: code }
  return { code, zh: text.zh, en: text.en }
}

function roleOf(raw: string): 'STUDENT' | 'TEACHER' | 'ADMIN' | null {
  const role = raw.trim().toUpperCase()
  if (role === 'STUDENT' || role === 'TEACHER' || role === 'ADMIN') return role
  return null
}

export function accountFormatIssue(role: string, account: string): 'missing_account' | 'bad_account' | null {
  if (!account) return 'missing_account'
  if (role === 'STUDENT' && !/^B\d{8}$/.test(account)) return 'bad_account'
  if (role === 'TEACHER' && !/^T\d{4}$/.test(account)) return 'bad_account'
  if (role === 'ADMIN' && !/^A\d{4}$/.test(account)) return 'bad_account'
  return null
}

export function emailIssue(email: string): 'missing_email' | 'bad_email' | null {
  if (!email) return 'missing_email'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !email.toLowerCase().endsWith('@nutc.edu.tw')) return 'bad_email'
  return null
}

function cohortNumber(raw: string): number | null {
  if (!/^\d{3}$/.test(raw)) return null
  const year = Number(raw)
  if (year < 100 || year > 200) return null
  return year
}

export function inspectAccounts(rows: Record<string, string>[], ctx: AccountContext): ImportRow[] {
  const seen = new Set<string>()
  return rows.map((fields, index) => {
    const errors: ImportIssue[] = []
    const role = roleOf(fields.role ?? '')
    if (!fields.role) errors.push(issue('missing_role'))
    else if (!role) errors.push(issue('bad_role'))
    if (!(fields.account ?? '')) errors.push(issue('missing_account'))
    else if (role) {
      const accountCode = accountFormatIssue(role, fields.account)
      if (accountCode) errors.push(issue(accountCode))
    } else if (!/^B\d{8}$/.test(fields.account) && !/^T\d{4}$/.test(fields.account) && !/^A\d{4}$/.test(fields.account)) {
      errors.push(issue('bad_account'))
    }
    if (!(fields.nameZh ?? '')) errors.push(issue('missing_name'))
    else if (fields.nameZh.length > 40 || (fields.nameEn ?? '').length > 80) errors.push(issue('bad_name'))
    const emailCode = emailIssue(fields.email ?? '')
    if (emailCode) errors.push(issue(emailCode))
    const cohortRaw = fields.cohortYear ?? ''
    const cohort = cohortNumber(cohortRaw)
    if (role === 'STUDENT' && !cohortRaw) errors.push(issue('missing_cohort'))
    else if (cohortRaw && (cohort == null || !ctx.cohorts.has(cohort))) errors.push(issue('bad_cohort'))
    let classId: string | null = null
    if (fields.className) {
      const found = ctx.classes.find((item) => item.cohortYear === cohort && (item.nameZh === fields.className || item.nameEn === fields.className))
      if (!found) errors.push(issue('bad_class'))
      else classId = found.id
    }
    const key = (fields.account ?? '').toUpperCase()
    const duplicate = Boolean(key) && seen.has(key)
    if (key) seen.add(key)
    let status: RowStatus = 'valid'
    if (duplicate) status = 'duplicate'
    else if (errors.length) status = 'error'
    else if (ctx.accounts.has(fields.account)) status = 'conflict'
    if (status === 'duplicate') errors.unshift(issue('duplicate'))
    if (status === 'conflict') errors.unshift(issue('conflict'))
    const draft: AccountDraft | undefined =
      (status === 'valid' || status === 'conflict') && role
        ? {
            account: fields.account,
            nameZh: fields.nameZh,
            nameEn: fields.nameEn || fields.nameZh,
            email: fields.email.toLowerCase(),
            role,
            cohortYear: cohort,
            classId,
          }
        : undefined
    return { line: index + 2, status, errors, fields, account: draft }
  })
}

export function inspectCredits(rows: Record<string, string>[], ctx: CreditContext): ImportRow[] {
  const seen = new Set<string>()
  const students = new Map(ctx.students.map((item) => [item.account, item]))
  return rows.map((fields, index) => {
    const errors: ImportIssue[] = []
    const accountCode = accountFormatIssue('STUDENT', fields.account ?? '')
    if (accountCode) errors.push(issue(accountCode))
    const student = accountCode ? undefined : students.get(fields.account)
    if (!accountCode && !student) errors.push(issue('unknown_student'))
    if (!(fields.courseNameZh ?? '')) errors.push(issue('missing_course'))
    if (!(fields.categoryCode ?? '')) errors.push(issue('missing_category'))
    if (!(fields.credits ?? '')) errors.push(issue('missing_credits'))
    let credits: number | null = null
    if (fields.credits) {
      if (!/^\d+(\.\d+)?$/.test(fields.credits)) errors.push(issue('bad_credits'))
      else {
        credits = Number(fields.credits)
        if (!(credits > 0 && credits <= 30)) errors.push(issue('bad_credits'))
      }
    }
    if (!(fields.termYear ?? '') || !(fields.termSemester ?? '')) errors.push(issue('missing_term'))
    const termYear = /^\d{3}$/.test(fields.termYear ?? '') ? Number(fields.termYear) : null
    if ((fields.termYear ?? '') && (termYear == null || termYear < 100 || termYear > 200)) errors.push(issue('bad_term'))
    const semester = fields.termSemester === '1' || fields.termSemester === '2' ? Number(fields.termSemester) : null
    if ((fields.termSemester ?? '') && semester == null) errors.push(issue('bad_semester'))
    if (student?.cohortYear && fields.courseNameZh && fields.categoryCode) {
      const courses = ctx.courses.filter((item) => item.cohortYear === student.cohortYear)
      const course = courses.find((item) => item.nameZh === fields.courseNameZh || item.nameEn === fields.courseNameZh || item.nameEn === (fields.courseNameEn ?? ''))
      const categories = new Set(ctx.categories.filter((item) => item.cohortYear === student.cohortYear).map((item) => item.code))
      if (!course) errors.push(issue('unknown_course'))
      if (!categories.has(fields.categoryCode) && fields.categoryCode !== course?.requirementType) errors.push(issue('unknown_category'))
      if (course && fields.categoryCode !== course.requirementType) errors.push(issue('category_mismatch'))
    }
    const key = [fields.account, fields.courseNameZh, fields.termYear, fields.termSemester].join('|')
    const duplicate = Boolean(fields.account && fields.courseNameZh && fields.termYear && fields.termSemester) && seen.has(key)
    if (fields.account && fields.courseNameZh) seen.add(key)
    const uniqueErrors = errors.filter((item, itemIndex) => errors.findIndex((other) => other.code === item.code) === itemIndex)
    const existing = student && termYear && semester && fields.courseNameZh
      ? ctx.existing.find((item) => item.account === fields.account && item.courseNameZh === fields.courseNameZh && item.termYear === termYear && item.termSemester === semester)
      : undefined
    let status: RowStatus = 'valid'
    if (duplicate) status = 'duplicate'
    else if (uniqueErrors.length) status = 'error'
    else if (existing) status = 'conflict'
    if (status === 'duplicate') uniqueErrors.unshift(issue('duplicate'))
    if (status === 'conflict') uniqueErrors.unshift(issue('conflict'))
    const draft: CreditDraft | undefined =
      (status === 'valid' || status === 'conflict') && student && credits != null && termYear && semester
        ? {
            account: fields.account,
            studentId: student.id,
            courseNameZh: fields.courseNameZh,
            courseNameEn: fields.courseNameEn || fields.courseNameZh,
            categoryCode: fields.categoryCode,
            credits,
            grade: fields.grade || null,
            termYear,
            termSemester: semester,
            domain: fields.domain || null,
            passed: fields.passed !== 'false' && fields.passed !== '否',
            existingId: existing?.id ?? null,
          }
        : undefined
    return { line: index + 2, status, errors: uniqueErrors, fields, credit: draft }
  })
}

export function countRows(rows: ImportRow[]) {
  return {
    valid: rows.filter((row) => row.status === 'valid').length,
    error: rows.filter((row) => row.status === 'error').length,
    duplicate: rows.filter((row) => row.status === 'duplicate').length,
    conflict: rows.filter((row) => row.status === 'conflict').length,
  }
}

export function templateCsv(kind: ImportKind) {
  if (kind === 'accounts') {
    return stringify(
      [
        { account: 'B11523901', nameZh: '範例生', nameEn: 'Example Student', email: 'b11523901@nutc.edu.tw', role: 'STUDENT', cohortYear: '115', className: '智應一甲', classNameEn: 'AI Year 1 A' },
      ],
      { header: true },
    )
  }
  return stringify(
    [
      { account: 'B11523001', courseNameZh: '程式設計', courseNameEn: 'Programming', categoryCode: 'MAJOR_REQUIRED', credits: '3', grade: '90', termYear: '115', termSemester: '1', domain: '', passed: 'true' },
    ],
    { header: true },
  )
}

export function errorReportCsv(rows: ImportRow[]) {
  const flagged = rows.filter((row) => row.status === 'error' || row.status === 'duplicate')
  return stringify(
    flagged.map((row) => ({
      line: row.line,
      status: row.status,
      errors: row.errors.map((item) => item.code).join('|'),
      messageZh: row.errors.map((item) => item.zh).join('；'),
      messageEn: row.errors.map((item) => item.en).join('; '),
      ...row.fields,
    })),
    { header: true },
  )
}
