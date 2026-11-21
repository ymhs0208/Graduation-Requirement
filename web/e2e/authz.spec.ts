import { expect, test } from '@playwright/test'

test('assigned teacher can read a file but cannot approve it', async ({ request }) => {
  const teacher = await request.post('/api/auth/login', { data: { account: 'T1001', password: 'Teach#Nutc2026' } })
  expect(teacher.ok()).toBeTruthy()
  const roster = await request.get('/api/teacher/students')
  const students = (await roster.json()).students as { id: string; account: string }[]
  const student = students.find((item) => item.account === 'B11023015')
  expect(student).toBeTruthy()
  const detail = await request.get(`/api/teacher/students/${student!.id}`)
  const body = await detail.json()
  expect(body.submissions.length).toBeGreaterThan(0)
  const fileId = body.submissions[0].files[0].id as string
  const preview = await request.get(`/api/files/${fileId}?disposition=inline`)
  expect(preview.ok()).toBeTruthy()
  expect(preview.headers()['x-content-type-options']).toBe('nosniff')
  expect(preview.headers()['content-disposition']).toContain('inline')
  const denied = await request.post(`/api/admin/reviews/${body.submissions[0].id}`, {
    data: { decision: 'APPROVED', comment: 'teacher must not' },
  })
  expect(denied.status()).toBe(403)
  const other = await request.post('/api/auth/login', { data: { account: 'T1002', password: 'Teach#Nutc2026' } })
  expect(other.ok()).toBeTruthy()
  const blocked = await request.get(`/api/teacher/students/${student!.id}`)
  expect(blocked.status()).toBe(403)
})
