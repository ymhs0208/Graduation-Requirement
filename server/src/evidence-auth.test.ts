import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { currentTotp } from './crypto'
import { DEMO_ADMIN_TOTP, DEMO_PASSWORD } from './demo'
import { prisma } from './db'
import { seed } from './seed'

const app = createApp()
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const editedPdf = Buffer.from(`%PDF-1.4
1 0 obj
<< /Producer (Adobe Photoshop) /Creator (GIMP) /CreationDate (D:20200101120000) /ModDate (D:20240601120000) /FT /Sig >>
endobj
%%EOF`)

async function login(account: string, password: string, totp?: string) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/login').send({ account, password, totp })
  expect(response.status).toBe(200)
  return { agent, csrf: response.body.csrfToken as string, id: response.body.user.id as string }
}

async function upload(account: string, certificateNumber: string, file: Buffer, filename: string, mime: string) {
  const student = await login(account, DEMO_PASSWORD.student)
  const dashboard = await student.agent.get('/api/me/dashboard')
  const english = dashboard.body.progress.thresholds.find((item: { code: string }) => item.code === 'ENGLISH')
  const toeic = dashboard.body.recognized.find((item: { nameEn: string }) => item.nameEn.includes('TOEIC'))
  const created = await student.agent
    .post('/api/me/submissions')
    .set('x-csrf-token', student.csrf)
    .field('thresholdId', english.id)
    .field('recognizedItemId', toeic.id)
    .field('scoreText', '600')
    .field('certificateNumber', certificateNumber)
    .field('issuingBody', 'ETS')
    .field('issuedOn', '2026-06-01')
    .field('declaration', 'true')
    .attach('files', file, { filename, contentType: mime })
  expect(created.status).toBe(201)
  return { student, id: created.body.id as string }
}

describe('evidence authenticity', () => {
  beforeAll(async () => {
    await seed()
  })

  it('requires the declaration and certificate details, and records who accepted them', async () => {
    const student = await login('B11323003', DEMO_PASSWORD.student)
    const dashboard = await student.agent.get('/api/me/dashboard')
    const english = dashboard.body.progress.thresholds.find((item: { code: string }) => item.code === 'ENGLISH')
    const toeic = dashboard.body.recognized.find((item: { nameEn: string }) => item.nameEn.includes('TOEIC'))
    const missing = await student.agent
      .post('/api/me/submissions')
      .set('x-csrf-token', student.csrf)
      .field('thresholdId', english.id)
      .field('recognizedItemId', toeic.id)
      .field('scoreText', '600')
      .attach('files', png, { filename: 'score.png', contentType: 'image/png' })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toBe('DECLARATION_REQUIRED')
    const incomplete = await student.agent
      .post('/api/me/submissions')
      .set('x-csrf-token', student.csrf)
      .field('thresholdId', english.id)
      .field('recognizedItemId', toeic.id)
      .field('scoreText', '600')
      .field('declaration', 'true')
      .attach('files', png, { filename: 'score.png', contentType: 'image/png' })
    expect(incomplete.status).toBe(400)
    expect(incomplete.body.error).toBe('EVIDENCE_DETAILS')

    const created = await upload('B11323003', 'GEPT-ONLY-113', png, 'score.png', 'image/png')
    const log = await prisma.auditLog.findFirst({ where: { action: 'submission.create', entityId: created.id } })
    const after = log?.after as { userId?: string; account?: string; ip?: string; declarationAcceptedAt?: string }
    expect(after.userId).toBe(created.student.id)
    expect(after.account).toBe('B11323003')
    expect(after.declarationAcceptedAt).toBeTruthy()
    expect(typeof after.ip).toBe('string')
    const row = await prisma.submission.findUnique({ where: { id: created.id } })
    expect(row?.declaredAt).toBeTruthy()
    expect(row?.declarationIp).toBeTruthy()
  })

  it('shows duplicate and metadata warnings only to an admin, and blocks approval until verified', async () => {
    const first = await upload('B11523001', 'TOEIC-SHARED-9', editedPdf, 'score.pdf', 'application/pdf')
    const second = await upload('B11223001', 'TOEIC-SHARED-9', editedPdf, 'score.pdf', 'application/pdf')
    const own = await first.student.agent.get('/api/me/dashboard')
    expect(JSON.stringify(own.body)).not.toMatch(/duplicateFile|duplicateCertificate|editedBySoftware|hasDigitalSignature/)

    const advisor = await login('T1002', DEMO_PASSWORD.teacher)
    const roster = await advisor.agent.get('/api/teacher/students')
    const student = roster.body.students.find((item: { account: string }) => item.account === 'B11523001')
    const detail = await advisor.agent.get(`/api/teacher/students/${student.id}`)
    expect(detail.status).toBe(200)
    expect(JSON.stringify(detail.body)).not.toMatch(/duplicateFile|duplicateCertificate|editedBySoftware|hasDigitalSignature/)
    const forbidden = await advisor.agent
      .post(`/api/admin/reviews/${first.id}`)
      .set('x-csrf-token', advisor.csrf)
      .send({ decision: 'APPROVED', verified: true, verificationMethod: 'PAPER_ORIGINAL' })
    expect(forbidden.status).toBe(403)

    const admin = await login('A0001', DEMO_PASSWORD.admin, currentTotp(DEMO_ADMIN_TOTP))
    const queue = await admin.agent.get('/api/admin/reviews')
    const pending = queue.body.submissions.filter((item: { id: string }) => item.id === first.id || item.id === second.id)
    expect(pending).toHaveLength(2)
    for (const item of pending) {
      expect(item.authenticity.duplicateFile).toBe(true)
      expect(item.authenticity.duplicateCertificate).toBe(true)
      expect(item.authenticity.files[0].editedBySoftware).toBe(true)
      expect(item.authenticity.files[0].modifiedAfterCreate).toBe(true)
      expect(item.authenticity.files[0].hasDigitalSignature).toBe(true)
      expect(item.authenticity.files[0].signatureVerified).toBe(false)
    }
    const target = pending.find((item: { id: string }) => item.id === first.id)

    const marked = await admin.agent
      .patch(`/api/admin/thresholds/${target.threshold.id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ requiresPaperOriginal: true })
    expect(marked.status).toBe(200)
    const blocked = await admin.agent
      .post(`/api/admin/reviews/${first.id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ decision: 'APPROVED', comment: '未核對' })
    expect(blocked.status).toBe(400)
    expect(blocked.body.error).toBe('VERIFICATION_REQUIRED')
    const approved = await admin.agent
      .post(`/api/admin/reviews/${first.id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ decision: 'APPROVED', comment: '已核對紙本', verified: true, verificationMethod: 'PAPER_ORIGINAL' })
    expect(approved.status).toBe(200)
    const saved = await prisma.submission.findUnique({ where: { id: first.id } })
    expect(saved?.status).toBe('APPROVED')
    expect(saved?.verificationMethod).toBe('PAPER_ORIGINAL')
    expect(saved?.verifiedById).toBe(admin.id)
  })
})
