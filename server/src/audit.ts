import { prisma } from './db'

export async function audit(input: {
  actorId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  summaryZh: string
  summaryEn: string
  before?: unknown
  after?: unknown
}) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summaryZh: input.summaryZh,
      summaryEn: input.summaryEn,
      before: input.before === undefined ? undefined : (input.before as object),
      after: input.after === undefined ? undefined : (input.after as object),
    },
  })
}
