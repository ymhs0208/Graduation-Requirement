import { prisma } from './db'
import { audit } from './audit'
import { removeStored } from './files'
import { notify } from './mail'
import { calendar, progressFor, studyYearOf } from './progress'
import { hashPassword, randomToken } from './crypto'

export async function runPreaudit(cohortYear: number, actorId: string | null) {
  const students = await prisma.user.findMany({
    where: { role: 'STUDENT', status: 'ACTIVE', cohortYear, anonymizedAt: null },
    include: { class: true },
  })
  const teacherBuckets = new Map<string, { zh: string; en: string }[]>()
  let missingCount = 0
  for (const student of students) {
    const progress = await progressFor(student.id)
    if (progress.verdict !== 'ready') missingCount += 1
    const missingZh = progress.missing.map((item) => item.nameZh).join('、')
    const missingEn = progress.missing.map((item) => item.nameEn).join(', ')
    const contactOffice = progress.office.length > 0 || !progress.totalConfirmed
    const result = auditResultLabel(progress.verdict)
    const bodyZh = `預審結果：${result.zh}。${missingZh ? `未完成項目：${missingZh}。` : ''}${contactOffice && progress.verdict !== 'needs_office' && progress.verdict !== 'no_rules' ? '完整畢業資格請洽系辦。' : ''}`
    const bodyEn = `Result: ${result.en}.${missingEn ? ` Incomplete requirements: ${missingEn}.` : ''}${contactOffice && progress.verdict !== 'needs_office' && progress.verdict !== 'no_rules' ? ' Contact the department office for a full eligibility review.' : ''}`
    await notify({
      userId: student.id,
      kind: 'preaudit',
      titleZh: `${cohortYear} 學年度大四上畢業預審`,
      titleEn: `Senior-year pre-audit for cohort ${cohortYear}`,
      bodyZh,
      bodyEn,
    })
    const advisorId = student.class?.advisorId
    if (advisorId) {
      const bucket = teacherBuckets.get(advisorId) ?? []
      bucket.push({ zh: `${student.account} ${student.nameZh}：${bodyZh}`, en: `${student.account} ${student.nameEn}: ${bodyEn}` })
      teacherBuckets.set(advisorId, bucket)
    }
  }
  for (const [advisorId, lines] of teacherBuckets) {
    await notify({
      userId: advisorId,
      kind: 'preaudit.advisor',
      titleZh: `${cohortYear} 學年度班級畢業預審`,
      titleEn: `Cohort ${cohortYear} pre-audit`,
      bodyZh: lines.map((line) => line.zh).join('\n'),
      bodyEn: lines.map((line) => line.en).join('\n'),
    })
  }
  const run = await prisma.preAuditRun.create({
    data: { cohortYear, triggeredBy: actorId, studentCount: students.length, missingCount },
  })
  await audit({
    actorId,
    action: 'preaudit.run',
    entityType: 'cohort',
    entityId: String(cohortYear),
    summaryZh: `執行 ${cohortYear} 入學年度畢業預審`,
    summaryEn: `Ran pre-audit for cohort ${cohortYear}`,
    after: { studentCount: students.length, missingCount },
  })
  return run
}

export async function runReminders() {
  const students = await prisma.user.findMany({ where: { role: 'STUDENT', status: 'ACTIVE', anonymizedAt: null } })
  let sent = 0
  for (const student of students) {
    const progress = await progressFor(student.id)
    for (const threshold of progress.thresholds) {
      if (!threshold.overdue || threshold.state !== 'missing') continue
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const recent = await prisma.notification.findFirst({
        where: { userId: student.id, kind: `deadline:${threshold.code}`, createdAt: { gte: since } },
      })
      if (recent) continue
      await notify({
        userId: student.id,
        kind: `deadline:${threshold.code}`,
        titleZh: `${threshold.nameZh} 已過建議期限`,
        titleEn: `${threshold.nameEn} is past the suggested deadline`,
        bodyZh: '這項門檻仍未完成。請上傳證明或與班導討論修課安排。',
        bodyEn: 'This threshold is still open. Upload evidence or talk with your advisor.',
      })
      sent += 1
    }
  }
  return { sent }
}

export async function retentionCutoff() {
  const policy = await prisma.retentionPolicy.findUnique({ where: { id: 1 } })
  const years = policy?.retentionYears ?? 5
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - years)
  return { years, cutoff }
}

export async function retentionCandidates() {
  const { years, cutoff } = await retentionCutoff()
  const users = await prisma.user.findMany({
    where: { deactivatedAt: { lt: cutoff }, anonymizedAt: null },
    select: { id: true, account: true, nameZh: true, deactivatedAt: true, deactivationReason: true },
  })
  return { years, cutoff, users }
}

export async function anonymizeUser(userId: string, actorId: string | null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { submissions: { include: { files: true } } },
  })
  if (!user || user.anonymizedAt) return null
  for (const submission of user.submissions) {
    for (const file of submission.files) await removeStored(file.storageKey)
  }
  await prisma.upload.deleteMany({ where: { submission: { studentId: userId } } })
  await prisma.submission.updateMany({
    where: { studentId: userId },
    data: { note: null, scoreText: null, reviewComment: null, teacherComment: null },
  })
  await prisma.comment.deleteMany({ where: { studentId: userId } })
  await prisma.notification.deleteMany({ where: { userId } })
  await prisma.session.deleteMany({ where: { userId } })
  await prisma.passwordReset.deleteMany({ where: { userId } })
  await prisma.emailLog.deleteMany({ where: { to: user.email } })
  const anonAccount = `anon${user.id.slice(-10)}`
  await prisma.user.update({
    where: { id: userId },
    data: {
      account: anonAccount,
      email: `${anonAccount}@invalid.local`,
      nameZh: '已去識別',
      nameEn: 'Anonymized',
      passwordHash: await hashPassword(randomToken()),
      totpSecret: null,
      totpEnabled: false,
      anonymizedAt: new Date(),
      status: 'DEACTIVATED',
    },
  })
  await audit({
    actorId,
    action: 'user.anonymize',
    entityType: 'user',
    entityId: userId,
    summaryZh: '依保存年限去識別個人資料並刪除上傳檔',
    summaryEn: 'Anonymized personal data and deleted uploads after the retention period',
  })
  return { id: userId }
}

export async function purgeRetention(actorId: string | null) {
  const { users } = await retentionCandidates()
  for (const user of users) await anonymizeUser(user.id, actorId)
  await audit({
    actorId,
    action: 'retention.purge',
    entityType: 'retention',
    entityId: 'policy',
    summaryZh: `去識別 ${users.length} 筆超過保存年限的帳號`,
    summaryEn: `Anonymized ${users.length} accounts past the retention period`,
    after: { count: users.length },
  })
  return { count: users.length }
}

export async function maybeScheduledPreaudit() {
  const cal = await calendar()
  const now = new Date()
  if (now.getMonth() + 1 !== cal.preauditMonth || now.getDate() !== cal.preauditDay) return null
  const cohort = cal.academicYear - 3
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const existing = await prisma.preAuditRun.findFirst({ where: { cohortYear: cohort, runAt: { gte: yearStart } } })
  if (existing) return null
  return runPreaudit(cohort, null)
}

export function seniorCohort(academicYear: number) {
  return academicYear - 3
}

export { studyYearOf }

function auditResultLabel(verdict: string) {
  if (verdict === 'ready') return { zh: '可畢業', en: 'Eligible to graduate' }
  if (verdict === 'blocked') return { zh: '仍有缺項', en: 'Requirements incomplete' }
  if (verdict === 'pending_review') return { zh: '審核中', en: 'Evidence under review' }
  return { zh: '畢業資格請洽系辦', en: 'Contact the department office about graduation eligibility' }
}
