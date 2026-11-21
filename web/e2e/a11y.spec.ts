import { execSync } from 'node:child_process'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(tags).analyze()
  expect(results.violations, JSON.stringify(results.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => node.html) })), null, 2)).toEqual([])
}

async function signIn(page: Page, account: string, password: string, code?: string) {
  await page.goto('/login')
  await page.getByLabel('學號或教職員編號').fill(account)
  await page.getByLabel('密碼', { exact: true }).fill(password)
  if (code) await page.getByLabel('驗證碼').fill(code)
  await page.getByRole('button', { name: '登入', exact: true }).click()
}

test('login page has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/login')
  await expectAccessible(page)
})

test('student pages have no WCAG 2.1 AA violations', async ({ page }) => {
  await signIn(page, 'B11023008', 'Study#Nutc2026')
  await page.getByRole('heading', { name: '林可芯' }).waitFor()
  await expectAccessible(page)
  for (const path of ['/plan', '/evidence', '/notifications', '/help']) {
    await page.goto(path)
    await page.locator('#main').waitFor()
    await expectAccessible(page)
  }
})

test('teacher class list has no WCAG 2.1 AA violations', async ({ page }) => {
  await signIn(page, 'T1001', 'Teach#Nutc2026')
  await page.getByRole('link', { name: 'B11023015' }).waitFor()
  await expectAccessible(page)
})

test('admin pages have no WCAG 2.1 AA violations', async ({ page }) => {
  const code = execSync('npx tsx src/print-totp.ts', { cwd: '../server' }).toString().trim().split('\n').pop()
  await signIn(page, 'A0001', 'Admin#Nutc2026', code)
  await page.getByRole('button', { name: '執行大四預審' }).waitFor()
  await expectAccessible(page)
  for (const path of ['/admin/reviews', '/admin/users', '/admin/rules', '/admin/help']) {
    await page.goto(path === '/admin/help' ? '/help' : path)
    await page.locator('#main').waitFor()
    await expectAccessible(page)
  }
})
