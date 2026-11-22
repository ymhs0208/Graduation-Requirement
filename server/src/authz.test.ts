import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { currentTotp } from './crypto'
import { DEMO_ADMIN_TOTP, DEMO_PASSWORD } from './demo'
import { prisma } from './db'
import { seed } from './seed'
import { sniff } from './files'

const app = createApp()
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function login(account: string, password: string, totp?: string) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/login').send({ account, password, totp })
  expect(response.status).toBe(200)
  return { agent, csrf: response.body.csrfToken as string }
}

describe('authorization', () => {
  beforeAll(async () => {
    await seed()
  })

  it('requires a second factor for an enrolled admin and protects passkey settings', async () => {
    const credentials = { account: 'A0001', password: DEMO_PASSWORD.admin }
    const passwordOnly = await request(app).post('/api/auth/login').send(credentials)
    expect(passwordOnly.status).toBe(401)
    expect(passwordOnly.body.error).toBe('TOTP_REQUIRED')
    expect(passwordOnly.headers['set-cookie']).toBeUndefined()

    const student = await login('B11023008', DEMO_PASSWORD.student)
    expect((await student.agent.get('/api/auth/passkeys')).status).toBe(403)
    const attempted = await request(app).post('/api/auth/login').send({
      account: 'B11023008',
      password: DEMO_PASSWORD.student,
      passkey: { action: 'start' },
    })
    expect(attempted.status).toBe(403)
    expect(attempted.headers['set-cookie']).toBeUndefined()

    const admin = await login(credentials.account, credentials.password, currentTotp(DEMO_ADMIN_TOTP))
    const setup = await admin.agent.post('/api/auth/totp/setup').set('x-csrf-token', admin.csrf).send({})
    expect(setup.status).toBe(409)
    expect(setup.body.secret).toBeUndefined()
    expect((await admin.agent.get('/api/auth/passkeys')).status).toBe(200)
  })

  it('rejects a non-image upload and a cross-student file read', async () => {
    expect(sniff(Buffer.from('not a file'))).toBeNull()
    expect(sniff(png)?.mime).toBe('image/png')
    const student = await login('B11523001', DEMO_PASSWORD.student)
    const dashboard = await student.agent.get('/api/me/dashboard')
    const english = dashboard.body.progress.thresholds.find((item: { code: string }) => item.code === 'ENGLISH')
    const toeic = dashboard.body.recognized.find((item: { nameEn: string }) => item.nameEn.includes('TOEIC'))
    const uploaded = await student.agent
      .post('/api/me/submissions')
      .set('x-csrf-token', student.csrf)
      .field('thresholdId', english.id)
      .field('recognizedItemId', toeic.id)
      .field('scoreText', '600')
      .attach('files', png, { filename: 'score.png', contentType: 'image/png' })
    expect(uploaded.status).toBe(201)

    const bad = await student.agent
      .post('/api/me/submissions')
      .set('x-csrf-token', student.csrf)
      .field('thresholdId', english.id)
      .field('recognizedItemId', toeic.id)
      .field('scoreText', '600')
      .attach('files', Buffer.from('hello'), { filename: 'score.png', contentType: 'image/png' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('FILE_TYPE')

    const own = await student.agent.get('/api/me/dashboard')
    const fileId = own.body.submissions[0].files[0].id as string
    const preview = await student.agent.get(`/api/files/${fileId}?disposition=inline`)
    expect(preview.status).toBe(200)
    expect(preview.headers['content-type']).toContain('image/png')
    expect(preview.headers['x-content-type-options']).toBe('nosniff')
    expect(String(preview.headers['content-disposition'])).toContain('inline')

    const other = await login('B11023008', DEMO_PASSWORD.student)
    const stolen = await other.agent.get(`/api/files/${fileId}?disposition=inline`)
    expect(stolen.status).toBe(403)
  })

  it('lets the assigned teacher view but not approve', async () => {
    const advisor = await login('T1002', DEMO_PASSWORD.teacher)
    const roster = await advisor.agent.get('/api/teacher/students')
    const freshman = roster.body.students.find((item: { account: string }) => item.account === 'B11523001')
    expect(freshman).toBeTruthy()
    const detail = await advisor.agent.get(`/api/teacher/students/${freshman.id}`)
    expect(detail.status).toBe(200)
    const fileId = detail.body.submissions[0].files[0].id as string
    const preview = await advisor.agent.get(`/api/files/${fileId}?disposition=inline`)
    expect(preview.status).toBe(200)

    const submissionId = detail.body.submissions[0].id as string
    const review = await advisor.agent
      .post(`/api/admin/reviews/${submissionId}`)
      .set('x-csrf-token', advisor.csrf)
      .send({ decision: 'APPROVED', comment: 'no' })
    expect(review.status).toBe(403)
    const note = await advisor.agent
      .post(`/api/teacher/submissions/${submissionId}/note`)
      .set('x-csrf-token', advisor.csrf)
      .send({ comment: 'endorse', recommendation: 'endorse' })
    expect(note.status).toBe(404)
    const reminder = await advisor.agent
      .post(`/api/teacher/students/${freshman.id}/comments`)
      .set('x-csrf-token', advisor.csrf)
      .send({ body: '記得下週把英檢正本補上。' })
    expect(reminder.status).toBe(201)

    const otherTeacher = await login('T1001', DEMO_PASSWORD.teacher)
    const blocked = await otherTeacher.agent.get(`/api/teacher/students/${freshman.id}`)
    expect(blocked.status).toBe(403)
    const blockedFile = await otherTeacher.agent.get(`/api/files/${fileId}?disposition=inline`)
    expect(blockedFile.status).toBe(403)
    const otherReview = await otherTeacher.agent
      .post(`/api/admin/reviews/${submissionId}`)
      .set('x-csrf-token', otherTeacher.csrf)
      .send({ decision: 'REJECTED', comment: 'no' })
    expect(otherReview.status).toBe(403)
  })

  it('lets only an admin approval change the student result', async () => {
    const admin = await login('A0001', DEMO_PASSWORD.admin, currentTotp(DEMO_ADMIN_TOTP))
    const queue = await admin.agent.get('/api/admin/reviews')
    const pending = queue.body.submissions.find((item: { student: { account: string } }) => item.student.account === 'B11523001')
    const decided = await admin.agent
      .post(`/api/admin/reviews/${pending.id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ decision: 'APPROVED', comment: '600 分，達到 550。' })
    expect(decided.status).toBe(200)
    const duplicate = await admin.agent
      .post(`/api/admin/reviews/${pending.id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ decision: 'REJECTED', comment: '不應覆蓋原審核結果。' })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toBe('REVIEW_ALREADY_COMPLETED')
    const student = await login('B11523001', DEMO_PASSWORD.student)
    const dashboard = await student.agent.get('/api/me/dashboard')
    const english = dashboard.body.progress.thresholds.find((item: { code: string }) => item.code === 'ENGLISH')
    expect(english.state).toBe('passed')
    const still = await prisma.submission.findUnique({ where: { id: pending.id } })
    expect(still?.status).toBe('APPROVED')
    expect(still?.teacherRecommendation).toBeNull()
  })

  it('blocks a deactivated account and a missing CSRF token', async () => {
    const blocked = await request(app).post('/api/auth/login').send({ account: 'B11023021', password: DEMO_PASSWORD.student })
    expect(blocked.status).toBe(403)
    expect(blocked.body.error).toBe('DEACTIVATED')
    const student = await login('B11223001', DEMO_PASSWORD.student)
    const forged = await student.agent.post('/api/me/onboarding').send({})
    expect(forged.status).toBe(403)
    expect(forged.body.error).toBe('CSRF')
  })
})
