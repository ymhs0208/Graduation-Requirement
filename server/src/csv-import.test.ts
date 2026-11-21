import iconv from 'iconv-lite'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { decodeCsv, inspectAccounts, inspectCredits, parseCsv, templateCsv, type AccountContext, type CreditContext } from './csv-import'
import { currentTotp } from './crypto'
import { prisma } from './db'
import { DEMO_ADMIN_TOTP, DEMO_PASSWORD } from './demo'
import { rememberPreview, type StoredPreview } from './import-commit'
import { seed } from './seed'

const cohorts = new Set([110, 115])
const classes = [{ id: 'class-1', nameZh: '智應一甲', nameEn: 'AI Year 1 A', cohortYear: 115 }]
const accountCtx: AccountContext = { classes, accounts: new Set(['B11523001', 'T1001']), cohorts }

function accounts(csv: string) {
  return inspectAccounts(parseCsv(csv), accountCtx)
}

const creditCtx: CreditContext = {
  students: [{ id: 'stu-1', account: 'B11523001', cohortYear: 115 }],
  courses: [{ cohortYear: 115, nameZh: '程式設計', nameEn: 'Programming', requirementType: 'MAJOR_REQUIRED' }],
  categories: [{ cohortYear: 115, code: 'MAJOR_REQUIRED' }],
  existing: [{ id: 'cred-1', account: 'B11523001', courseNameZh: '程式設計', termYear: 115, termSemester: 1 }],
}

function credits(csv: string) {
  return inspectCredits(parseCsv(csv), creditCtx)
}

describe('csv import validation', () => {
  it('strips a UTF-8 BOM and decodes Big5', () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('account,nameZh\nB11523001,測試', 'utf8')])
    const decoded = decodeCsv(bom)
    expect(decoded.encoding).toBe('utf-8')
    expect(decoded.text.startsWith('account')).toBe(true)
    expect(decoded.text.includes('\uFEFF')).toBe(false)
    const big5 = iconv.encode('account,nameZh\nB11523901,陳小明', 'big5')
    const fromBig5 = decodeCsv(big5)
    expect(fromBig5.encoding).toBe('big5')
    expect(fromBig5.text).toContain('陳小明')
  })

  it('accepts Chinese headers', () => {
    const rows = accounts('學號,中文姓名,英文姓名,信箱,角色,入學年度,班級\nB11523901,新同學,New Student,b11523901@nutc.edu.tw,STUDENT,115,智應一甲')
    expect(rows[0]?.status).toBe('valid')
    expect(rows[0]?.account?.classId).toBe('class-1')
  })

  it('flags missing fields, id format, cohort, class, and email domain', () => {
    const csv = [
      'account,nameZh,nameEn,email,role,cohortYear,className',
      ',缺姓名,Missing,nope@gmail.com,STUDENT,115,智應一甲',
      'B12,格式,Bad,b12@nutc.edu.tw,STUDENT,115,智應一甲',
      'T12,教師,Teacher,t12@nutc.edu.tw,TEACHER,,',
      'B11523902,年度,Year,b11523902@nutc.edu.tw,STUDENT,999,智應一甲',
      'B11523903,班級,Class,b11523903@gmail.com,STUDENT,115,不存在',
      'B11523904,,No Name,b11523904@nutc.edu.tw,STUDENT,,',
    ].join('\n')
    const rows = accounts(csv)
    expect(rows[0]?.errors.map((item) => item.code)).toEqual(expect.arrayContaining(['missing_account', 'bad_email']))
    expect(rows[1]?.errors.map((item) => item.code)).toContain('bad_account')
    expect(rows[2]?.errors.map((item) => item.code)).toContain('bad_account')
    expect(rows[3]?.errors.map((item) => item.code)).toEqual(expect.arrayContaining(['bad_cohort', 'bad_class']))
    expect(rows[4]?.errors.map((item) => item.code)).toEqual(expect.arrayContaining(['bad_email', 'bad_class']))
    expect(rows[5]?.errors.map((item) => item.code)).toEqual(expect.arrayContaining(['missing_name', 'missing_cohort']))
    expect(rows.every((row) => row.status === 'error')).toBe(true)
    expect(rows[0]?.errors[0]?.zh).toBeTruthy()
    expect(rows[0]?.errors[0]?.en).toBeTruthy()
  })

  it('flags in-file duplicates and existing-record conflicts separately from valid rows', () => {
    const csv = [
      'account,nameZh,nameEn,email,role,cohortYear,className',
      'B11523901,新同學,New,b11523901@nutc.edu.tw,STUDENT,115,智應一甲',
      'B11523901,重複,Dup,b11523901@nutc.edu.tw,STUDENT,115,智應一甲',
      'B11523001,張安然,Chang,b11523001@nutc.edu.tw,STUDENT,115,智應一甲',
      'T1002,新教師,New Teacher,t1002b@nutc.edu.tw,TEACHER,,',
    ].join('\n')
    const rows = accounts(csv)
    expect(rows.map((row) => row.status)).toEqual(['valid', 'duplicate', 'conflict', 'valid'])
    expect(rows[1]?.errors.map((item) => item.code)).toContain('duplicate')
    expect(rows[2]?.errors.map((item) => item.code)).toContain('conflict')
  })

  it('flags non-numeric credits, range, unknown course, unknown category, and credit duplicates', () => {
    const csv = [
      'account,courseNameZh,courseNameEn,categoryCode,credits,grade,termYear,termSemester,domain,passed',
      'B11523001,程式設計,Programming,MAJOR_REQUIRED,3,90,115,2,,true',
      'B11523001,程式設計,Programming,ELECTIVE,3,90,114,1,,true',
      'B11523001,另一門,Other,NOPE,abc,90,115,1,,true',
      'B00,程式設計,Programming,MAJOR_REQUIRED,-1,90,115,9,,true',
      'B11523001,程式設計,Programming,MAJOR_REQUIRED,40,90,99,1,,true',
      'B11523001,程式設計,Programming,MAJOR_REQUIRED,3,90,115,1,,true',
      'B11523001,程式設計,Programming,MAJOR_REQUIRED,3,90,115,2,,true',
    ].join('\n')
    const rows = credits(csv)
    expect(rows[0]?.status).toBe('valid')
    expect(rows[1]?.errors.map((item) => item.code)).toEqual(expect.arrayContaining(['category_mismatch', 'unknown_category']))
    expect(rows[2]?.errors.map((item) => item.code)).toEqual(expect.arrayContaining(['unknown_course', 'unknown_category', 'bad_credits']))
    expect(rows[3]?.errors.map((item) => item.code)).toEqual(expect.arrayContaining(['bad_account', 'bad_credits', 'bad_semester']))
    expect(rows[4]?.errors.map((item) => item.code)).toEqual(expect.arrayContaining(['bad_credits', 'bad_term']))
    expect(rows[5]?.status).toBe('conflict')
    expect(rows[6]?.status).toBe('duplicate')
  })

  it('builds a template and keeps the example row parsable', () => {
    const text = templateCsv('accounts')
    expect(text.split('\n')[0]).toContain('account')
    expect(parseCsv(text)[0]?.role).toBe('STUDENT')
  })
})

describe('csv import commit', () => {
  const app = createApp()

  beforeAll(async () => {
    await seed()
  })

  async function admin() {
    const agent = request.agent(app)
    const response = await agent.post('/api/auth/login').send({ account: 'A0001', password: DEMO_PASSWORD.admin, totp: currentTotp(DEMO_ADMIN_TOTP) })
    expect(response.status).toBe(200)
    return { agent, csrf: response.body.csrfToken as string }
  }

  it('previews without writing, then commits only valid rows in one transaction', async () => {
    const { agent, csrf } = await admin()
    const before = await prisma.user.count({ where: { account: { in: ['B11523911', 'B11523912'] } } })
    expect(before).toBe(0)
    const csv = [
      'account,nameZh,nameEn,email,role,cohortYear,className',
      'B11523911,有效甲,Valid A,b11523911@nutc.edu.tw,STUDENT,115,智應一甲',
      'B11523912,有效乙,Valid B,b11523912@nutc.edu.tw,STUDENT,115,智應一甲',
      'B12,錯誤,Bad,bad@gmail.com,STUDENT,115,智應一甲',
      'B11523001,張安然,Chang,b11523001@nutc.edu.tw,STUDENT,115,智應一甲',
    ].join('\n')
    const preview = await agent.post('/api/admin/import/preview').set('x-csrf-token', csrf).send({ kind: 'accounts', csv })
    expect(preview.status).toBe(200)
    expect(preview.body.counts).toMatchObject({ valid: 2, error: 1, conflict: 1 })
    expect(await prisma.user.count({ where: { account: { in: ['B11523911', 'B11523912'] } } })).toBe(0)
    const denied = await agent.post('/api/admin/import/commit').set('x-csrf-token', csrf).send({ previewId: preview.body.previewId, conflict: 'skip', confirm: false })
    expect(denied.status).toBe(400)
    const committed = await agent.post('/api/admin/import/commit').set('x-csrf-token', csrf).send({ previewId: preview.body.previewId, conflict: 'skip', confirm: true })
    expect(committed.status).toBe(200)
    expect(committed.body.committed).toBe(2)
    expect(committed.body.skipped).toBe(1)
    expect(await prisma.user.findUnique({ where: { account: 'B11523911' } })).toBeTruthy()
    expect(await prisma.user.findUnique({ where: { account: 'B12' } })).toBeNull()
    const unchanged = await prisma.user.findUnique({ where: { account: 'B11523001' } })
    expect(unchanged?.nameZh).toBe('張安然')

    const again = await agent.post('/api/admin/import/preview').set('x-csrf-token', csrf).send({
      kind: 'accounts',
      csv: 'account,nameZh,nameEn,email,role,cohortYear,className\nB11523911,改名,Renamed,b11523911@nutc.edu.tw,STUDENT,115,智應一甲',
    })
    const skipped = await agent.post('/api/admin/import/commit').set('x-csrf-token', csrf).send({ previewId: again.body.previewId, conflict: 'skip', confirm: true })
    expect(skipped.body.skipped).toBe(1)
    expect((await prisma.user.findUnique({ where: { account: 'B11523911' } }))?.nameZh).toBe('有效甲')
    const updatePreview = await agent.post('/api/admin/import/preview').set('x-csrf-token', csrf).send({
      kind: 'accounts',
      csv: 'account,nameZh,nameEn,email,role,cohortYear,className\nB11523911,改名,Renamed,b11523911@nutc.edu.tw,STUDENT,115,智應一甲',
    })
    const updated = await agent.post('/api/admin/import/commit').set('x-csrf-token', csrf).send({ previewId: updatePreview.body.previewId, conflict: 'update', confirm: true })
    expect(updated.body.updated).toBe(1)
    expect((await prisma.user.findUnique({ where: { account: 'B11523911' } }))?.nameZh).toBe('改名')
  })

  it('rolls back the whole import when a write fails', async () => {
    const broken: StoredPreview = {
      id: 'rollback-preview',
      actorId: 'missing-admin',
      kind: 'accounts',
      encoding: 'utf-8',
      createdAt: Date.now(),
      used: false,
      rows: [
        {
          line: 2,
          status: 'valid',
          errors: [],
          fields: {},
          account: { account: 'B11523921', nameZh: '回滾甲', nameEn: 'Rollback A', email: 'b11523921@nutc.edu.tw', role: 'STUDENT', cohortYear: 115, classId: 'does-not-exist' },
        },
      ],
    }
    const adminUser = await prisma.user.findUnique({ where: { account: 'A0001' } })
    broken.actorId = adminUser!.id
    rememberPreview(broken)
    const { commitPreview } = await import('./import-commit')
    await expect(commitPreview(adminUser!.id, broken.id, 'skip')).rejects.toThrow()
    expect(await prisma.user.findUnique({ where: { account: 'B11523921' } })).toBeNull()
  })

  it('downloads an error report for flagged rows', async () => {
    const { agent, csrf } = await admin()
    const preview = await agent.post('/api/admin/import/preview').set('x-csrf-token', csrf).send({
      kind: 'credits',
      csv: 'account,courseNameZh,categoryCode,credits,termYear,termSemester\nB11523001,不存在,MAJOR_REQUIRED,3,115,1\nB11523001,不存在,MAJOR_REQUIRED,3,115,1',
    })
    expect(preview.body.counts.error).toBe(1)
    expect(preview.body.counts.duplicate).toBe(1)
    const report = await agent.get(`/api/admin/import/${preview.body.previewId}/errors`).set('x-csrf-token', csrf)
    expect(report.status).toBe(200)
    expect(report.headers['content-type']).toContain('text/csv')
    expect(report.text).toContain('unknown_course')
    expect(report.text).toContain('duplicate')
  })
})
