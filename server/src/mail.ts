import nodemailer from 'nodemailer'
import { prisma } from './db'
import { env } from './env'

export async function sendMail(to: string, subject: string, body: string) {
  if (!to.toLowerCase().endsWith('@nutc.edu.tw')) {
    await prisma.emailLog.create({ data: { to, subject, body, status: 'blocked-domain' } })
    return 'blocked-domain'
  }
  if (!env.smtpHost) {
    await prisma.emailLog.create({ data: { to, subject, body, status: 'logged' } })
    return 'logged'
  }
  const transport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  })
  try {
    await transport.sendMail({ from: env.smtpFrom, to, subject, text: body })
    await prisma.emailLog.create({ data: { to, subject, body, status: 'sent' } })
    return 'sent'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'send failed'
    await prisma.emailLog.create({ data: { to, subject, body: `${body}\n\n${message}`, status: 'error' } })
    return 'error'
  }
}

export async function notify(input: {
  userId: string
  kind: string
  titleZh: string
  titleEn: string
  bodyZh: string
  bodyEn: string
}) {
  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user || user.anonymizedAt) return
  const english = user.locale === 'en'
  let emailStatus = 'skipped'
  if (user.status === 'ACTIVE') {
    emailStatus = await sendMail(
      user.email,
      english ? input.titleEn : input.titleZh,
      english ? input.bodyEn : input.bodyZh,
    )
  }
  await prisma.notification.create({
    data: {
      userId: user.id,
      kind: input.kind,
      titleZh: input.titleZh,
      titleEn: input.titleEn,
      bodyZh: input.bodyZh,
      bodyEn: input.bodyEn,
      emailTo: user.email,
      emailStatus,
    },
  })
}
