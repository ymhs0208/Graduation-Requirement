import { execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const out = '/opt/cursor/artifacts'
const base = 'http://127.0.0.1:43123'
const totp = execSync('npm run totp --silent', { cwd: '/agent/repos/tmp-d6ec933237c5fe2e/server' }).toString().trim().split('\n').pop()

async function login(page, account, password, code) {
  await page.goto(base)
  await page.getByLabel('學號或教職員編號').fill(account)
  await page.getByLabel('密碼', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登入', exact: true }).click()
  if (code) {
    await page.getByLabel('驗證碼', { exact: true }).fill(code)
    await page.getByRole('button', { name: '驗證並登入', exact: true }).click()
  }
  await page.waitForTimeout(800)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await mkdir(out, { recursive: true })

await login(page, 'B11023008', 'Study#Nutc2026')
await page.waitForSelector('text=林可芯')
await page.screenshot({ path: `${out}/student-zh-light.png`, fullPage: true })

await page.getByRole('button', { name: 'English' }).click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${out}/student-en-light.png`, fullPage: true })

await page.context().clearCookies()
await login(page, 'T1001', 'Teach#Nutc2026')
await page.waitForSelector('text=B11023015')
await page.screenshot({ path: `${out}/teacher-zh.png`, fullPage: true })
await page.getByRole('link', { name: 'B11023015' }).click()
await page.waitForSelector('text=吳承恩')
await page.getByRole('button', { name: /toeic/i }).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: `${out}/teacher-preview.png`, fullPage: true })

await page.context().clearCookies()
await login(page, 'A0001', 'Admin#Nutc2026', totp)
await page.waitForSelector('text=英文通過率')
await page.screenshot({ path: `${out}/admin-zh.png`, fullPage: true })
await page.getByRole('link', { name: '審核' }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${out}/admin-review.png`, fullPage: true })

await browser.close()
console.log('screenshots saved', totp)
