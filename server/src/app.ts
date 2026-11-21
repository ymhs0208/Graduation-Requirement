import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { env, isTest } from './env'
import { errorHandler, loadSession, requireCsrf } from './http'
import adminRoutes from './routes/admin'
import authRoutes from './routes/auth'
import fileRoutes from './routes/files'
import inboxRoutes from './routes/inbox'
import studentRoutes from './routes/student'
import teacherRoutes from './routes/teacher'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(
    helmet({
      contentSecurityPolicy: env.nodeEnv === 'production' && !isTest
        ? {
            directives: {
              defaultSrc: ["'self'"],
              imgSrc: ["'self'", 'data:', 'blob:'],
              styleSrc: ["'self'", "'unsafe-inline'"],
              scriptSrc: ["'self'"],
              connectSrc: ["'self'"],
              workerSrc: ["'self'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use(loadSession)
  app.use(requireCsrf)
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRoutes)
  app.use('/api/me', studentRoutes)
  app.use('/api/teacher', teacherRoutes)
  app.use('/api/admin', adminRoutes)
  app.use('/api/files', fileRoutes)
  app.use('/api/inbox', inboxRoutes)
  app.use(errorHandler)
  return app
}
