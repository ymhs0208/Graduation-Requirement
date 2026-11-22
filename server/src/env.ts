import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })
dotenv.config({ path: path.resolve(process.cwd(), '../.env') })

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  port: Number(process.env.PORT ?? 43124),
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), 'var/uploads'),
  appOrigin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:43123',
  passkeyOrigin: process.env.PASSKEY_ORIGIN,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  argonMemory: Number(process.env.ARGON_MEMORY ?? 19456),
  argonTime: Number(process.env.ARGON_TIME ?? 2),
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFrom: process.env.SMTP_FROM ?? 'gradtrack@nutc.edu.tw',
  smtpSecure: process.env.SMTP_SECURE === 'true',
  demoSeed: process.env.DEMO_SEED === 'true',
}

export const isTest = env.nodeEnv === 'test' || process.env.VITEST === 'true'
