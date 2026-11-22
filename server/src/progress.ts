import { prisma } from './db'

export type ThresholdState = 'passed' | 'under_review' | 'missing' | 'unpublished' | 'info'

export type Progress = {
  cohortYear: number | null
  studyYear: number | null
  semester: number
  academicYear: number
  verdict: 'ready' | 'blocked' | 'pending_review' | 'needs_office' | 'no_rules'
  atRisk: boolean
  delayed: boolean
  earnedTowardTotal: number
  requiredTotal: number | null
  totalConfirmed: boolean
  expectedCredits: number | null
  categories: {
    id: string
    code: string
    nameZh: string
    nameEn: string
    requiredCredits: number | null
    earned: number
    countsTowardTotal: boolean
    minDomains: number | null
    domains: number
    isPlaceholder: boolean
    met: boolean
    noteZh: string
    noteEn: string
  }[]
  thresholds: {
    id: string
    code: string
    nameZh: string
    nameEn: string
    descriptionZh: string
    descriptionEn: string
    kind: string
    state: ThresholdState
    isPlaceholder: boolean
    sourceUrl: string | null
    deadlineYear: number | null
    deadlineSemester: number | null
    overdue: boolean
  }[]
  missing: { code: string; nameZh: string; nameEn: string }[]
  office: { code: string; nameZh: string; nameEn: string }[]
}

export async function calendar() {
  const rows = await prisma.appSetting.findMany()
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return {
    academicYear: Number(map.academicYear ?? 115),
    semester: Number(map.semester ?? 1),
    preauditMonth: Number(map.preauditMonth ?? 9),
    preauditDay: Number(map.preauditDay ?? 1),
  }
}

export function studyYearOf(cohortYear: number, academicYear: number) {
  return academicYear - cohortYear + 1
}

function deadlinePassed(
  studyYear: number,
  semester: number,
  deadlineYear: number | null,
  deadlineSemester: number | null,
) {
  if (!deadlineYear) return false
  if (studyYear > deadlineYear) return true
  if (studyYear < deadlineYear) return false
  if (!deadlineSemester) return false
  return semester > deadlineSemester
}

export async function progressFor(userId: string): Promise<Progress> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  const cal = await calendar()
  if (!user?.cohortYear) {
    return emptyProgress(cal, null)
  }
  const rule = await prisma.ruleSet.findUnique({
    where: { cohortYear: user.cohortYear },
    include: { categories: { orderBy: { sort: 'asc' } }, thresholds: { orderBy: { sort: 'asc' } } },
  })
  const studyYear = studyYearOf(user.cohortYear, cal.academicYear)
  if (!rule) return emptyProgress(cal, user.cohortYear, studyYear)

  const [credits, submissions] = await Promise.all([
    prisma.creditRecord.findMany({ where: { studentId: userId, passed: true } }),
    prisma.submission.findMany({
      where: { studentId: userId },
      include: { recognizedItem: true },
    }),
  ])

  const categories = rule.categories.map((category) => {
    const rows = credits.filter((credit) => credit.categoryCode === category.code)
    const earned = round1(rows.reduce((sum, credit) => sum + credit.credits, 0))
    const domains = new Set(rows.map((credit) => credit.domain).filter(Boolean)).size
    const unknown = category.isPlaceholder || category.requiredCredits == null
    const enough =
      category.requiredCredits != null && earned + 0.001 >= category.requiredCredits && (!category.minDomains || domains >= category.minDomains)
    return {
      id: category.id,
      code: category.code,
      nameZh: category.nameZh,
      nameEn: category.nameEn,
      requiredCredits: category.requiredCredits,
      earned,
      countsTowardTotal: category.countsTowardTotal,
      minDomains: category.minDomains,
      domains,
      isPlaceholder: unknown,
      met: !unknown && enough,
      noteZh: category.noteZh,
      noteEn: category.noteEn,
    }
  })

  const thresholds = rule.thresholds.map((threshold) => {
    const related = submissions.filter((submission) => submission.thresholdId === threshold.id)
    const approved = related.some(
      (submission) => submission.status === 'APPROVED' && (submission.recognizedItem?.countsAsPass ?? true),
    )
    const pending = related.some((submission) => submission.status === 'PENDING')
    let state: ThresholdState = 'missing'
    if (threshold.kind === 'INFO') state = 'info'
    else if (threshold.kind === 'OPTIONAL') {
      if (approved) state = 'passed'
      else if (pending) state = 'under_review'
      else state = 'info'
    } else if (threshold.code === 'SERVICE') {
      const serviceCredits = credits
        .filter((credit) => credit.categoryCode === 'SERVICE')
        .reduce((sum, credit) => sum + credit.credits, 0)
      if (serviceCredits + 0.001 >= 1 || approved) state = 'passed'
      else if (pending) state = 'under_review'
      else state = 'missing'
    } else if (threshold.isPlaceholder) state = 'unpublished'
    else if (approved) state = 'passed'
    else if (pending) state = 'under_review'
    else state = 'missing'
    const overdue =
      state === 'missing' && deadlinePassed(studyYear, cal.semester, threshold.deadlineYear, threshold.deadlineSemester)
    return {
      id: threshold.id,
      code: threshold.code,
      nameZh: threshold.nameZh,
      nameEn: threshold.nameEn,
      descriptionZh: threshold.descriptionZh,
      descriptionEn: threshold.descriptionEn,
      kind: threshold.kind,
      state,
      isPlaceholder: threshold.isPlaceholder,
      sourceUrl: threshold.sourceUrl,
      deadlineYear: threshold.deadlineYear,
      deadlineSemester: threshold.deadlineSemester,
      overdue,
    }
  })

  const earnedTowardTotal = round1(
    categories.filter((category) => category.countsTowardTotal).reduce((sum, category) => sum + category.earned, 0),
  )
  const missing = [
    ...categories
      .filter((category) => !category.isPlaceholder && !category.met)
      .map((category) => ({ code: category.code, nameZh: category.nameZh, nameEn: category.nameEn })),
    ...thresholds
      .filter((threshold) => threshold.state === 'missing')
      .map((threshold) => ({ code: threshold.code, nameZh: threshold.nameZh, nameEn: threshold.nameEn })),
  ]
  const office = [
    ...categories
      .filter((category) => category.isPlaceholder)
      .map((category) => ({ code: category.code, nameZh: category.nameZh, nameEn: category.nameEn })),
    ...thresholds
      .filter((threshold) => threshold.state === 'unpublished')
      .map((threshold) => ({ code: threshold.code, nameZh: threshold.nameZh, nameEn: threshold.nameEn })),
  ]
  const pending = thresholds.some((threshold) => threshold.kind === 'NON_CREDIT' && threshold.state === 'under_review')
  let verdict: Progress['verdict'] = 'ready'
  if (missing.length) verdict = 'blocked'
  else if (pending) verdict = 'pending_review'
  else if (office.length || !rule.totalCreditsConfirmed) verdict = 'needs_office'

  const yearsCompleted = cal.semester === 1 ? Math.max(0, studyYear - 1) : studyYear - 0.5
  const fraction = Math.min(1, yearsCompleted / 4)
  const expectedCredits = rule.totalCreditsConfirmed && rule.totalCredits != null ? round1(rule.totalCredits * fraction) : null
  const behindPace = expectedCredits != null && studyYear >= 2 && earnedTowardTotal + 2 < expectedCredits
  const delayed = studyYear > 4 && verdict !== 'ready'
  const atRisk = thresholds.some((threshold) => threshold.overdue) || behindPace || delayed

  return {
    cohortYear: user.cohortYear,
    studyYear,
    semester: cal.semester,
    academicYear: cal.academicYear,
    verdict,
    atRisk,
    delayed,
    earnedTowardTotal,
    requiredTotal: rule.totalCredits,
    totalConfirmed: rule.totalCreditsConfirmed,
    expectedCredits,
    categories,
    thresholds,
    missing,
    office,
  }
}

function emptyProgress(
  cal: { academicYear: number; semester: number },
  cohortYear: number | null,
  studyYear: number | null = null,
): Progress {
  return {
    cohortYear,
    studyYear,
    semester: cal.semester,
    academicYear: cal.academicYear,
    verdict: 'no_rules',
    atRisk: false,
    delayed: false,
    earnedTowardTotal: 0,
    requiredTotal: null,
    totalConfirmed: false,
    expectedCredits: null,
    categories: [],
    thresholds: [],
    missing: [],
    office: [],
  }
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

export function publicUser(user: {
  id: string
  account: string
  email: string
  nameZh: string
  nameEn: string
  role: string
  status: string
  cohortYear: number | null
  classId: string | null
  mustChangePassword: boolean
  totpEnabled: boolean
  onboardingCompleted: boolean
  locale: string
  deactivationReason: string | null
  anonymizedAt: Date | null
}) {
  return {
    id: user.id,
    account: user.account,
    email: user.email,
    nameZh: user.nameZh,
    nameEn: user.nameEn,
    role: user.role,
    status: user.status,
    cohortYear: user.cohortYear,
    classId: user.classId,
    mustChangePassword: user.mustChangePassword,
    totpEnabled: user.totpEnabled,
    onboardingCompleted: user.onboardingCompleted,
    locale: user.locale,
    deactivationReason: user.deactivationReason,
    anonymized: Boolean(user.anonymizedAt),
  }
}
