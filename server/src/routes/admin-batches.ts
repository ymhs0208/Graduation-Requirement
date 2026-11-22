import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { batchErrorReport, batchKind, batchTemplate, parseBatch, type BatchKind, type CsvRow } from '../batch-csv'
import { inspectBatch, type BatchRow } from '../batch-rows'
import { prisma } from '../db'
import { HttpError } from '../errors'
import { asyncHandler, pid, type AuthedRequest } from '../http'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500_000, files: 1 } }).single('file')
const previewLifetime = 30 * 60 * 1000
const batchActions: Record<BatchKind, string> = {
  courses: 'plan.course.import', classes: 'class.import', recognized: 'recognized.import', reviews: 'submission.import',
}
const batchNames: Record<BatchKind, readonly [string, string]> = {
  courses: ['四年計畫課程', 'curriculum courses'], classes: ['班級與導師分配', 'class and advisor assignments'],
  recognized: ['認可清單', 'recognized items'], reviews: ['歷年門檻審核結果', 'historical reviews'],
}
type Preview = { id: string; actorId: string; kind: BatchKind; cohort?: number; source: CsvRow[]; rows: BatchRow[]; expires: number }
type Receipt = { batchId: string; added: number; updated: number; skipped: number; errors: number }
const previews = new Map<string, Preview>()

function sweep() {
  for (const [id, preview] of previews) if (Date.now() >= preview.expires) previews.delete(id)
}

function readPreview(id: string, kind: BatchKind, actorId: string) {
  sweep()
  const preview = previews.get(id)
  if (!preview || preview.kind !== kind || preview.actorId !== actorId) throw new HttpError(404, 'PREVIEW_EXPIRED')
  return preview
}

function attachment(res: import('express').Response, filename: string, data: string) {
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.attachment(filename)
  res.send(data)
}

function visibleRows(rows: BatchRow[]) {
  return rows.map((row) => ({
    line: row.line, label: row.label, status: row.status,
    ...('key' in row ? { changes: row.changes } : { messageZh: row.messageZh, messageEn: row.messageEn }),
  })).sort((a, b) => a.line - b.line)
}

function totals(rows: BatchRow[]) {
  const totals: Record<string, number> = {}
  for (const row of rows) if ('key' in row && row.credits) {
    const { type, amount } = row.credits
    totals[type] = (totals[type] ?? 0) + amount
  }
  return totals
}

function staleError() {
  return new HttpError(409, 'BATCH_STALE', {
    zh: '匯入資料已變動。請重新預覽並確認最新差異。',
    en: 'The records have changed. Preview the file again to review the latest differences.',
  })
}

router.get('/:kind/template', (req, res) => {
  const kind = batchKind.parse(req.params.kind)
  attachment(res, `${kind}-template.csv`, batchTemplate(kind))
})

router.post('/:kind/preview', upload, asyncHandler(async (req: AuthedRequest, res) => {
  const kind = batchKind.parse(req.params.kind)
  const cohort = kind === 'courses' ? z.coerce.number().int().min(100).max(200).parse(req.body?.cohort) : undefined
  if (!req.file?.buffer.length) throw new HttpError(400, 'CSV_EMPTY')
  const source = parseBatch(kind, req.file.buffer)
  const rows = await inspectBatch(prisma, kind, source, cohort)
  const preview: Preview = { id: randomUUID(), actorId: req.userId!, kind, cohort, source, rows, expires: Date.now() + previewLifetime }
  sweep()
  if (previews.size >= 100) previews.delete(previews.keys().next().value!)
  previews.set(preview.id, preview)
  res.json({ batchId: preview.id, rows: visibleRows(rows), credits: totals(rows) })
}))

router.get('/:kind/:id/errors', asyncHandler(async (req: AuthedRequest, res) => {
  const kind = batchKind.parse(req.params.kind)
  const preview = readPreview(pid(req.params.id), kind, req.userId!)
  attachment(res, `${kind}-errors.csv`, batchErrorReport(visibleRows(preview.rows).filter((row) => row.status === 'error' || row.status === 'duplicate')))
}))

const commitBody = z.object({ batchId: z.uuid(), update: z.boolean(), confirm: z.literal(true) })
router.post('/:kind/commit', asyncHandler(async (req: AuthedRequest, res) => {
  const kind = batchKind.parse(req.params.kind)
  const { batchId, update } = commitBody.parse(req.body)
  const actorId = req.userId!
  const existing = await prisma.auditLog.findFirst({ where: { id: batchId, actorId, action: batchActions[kind] }, select: { after: true } })
  if (existing?.after) return res.json(existing.after)
  const preview = readPreview(batchId, kind, actorId)
  let receipt: Receipt
  try {
    receipt = await prisma.$transaction(async (tx) => {
      const current = await inspectBatch(tx, kind, preview.source, preview.cohort)
      // Recheck dependencies and prior values immediately before writing, in the same transaction.
      if (JSON.stringify(current) !== JSON.stringify(preview.rows)) throw staleError()
      const result: Receipt = { batchId, added: 0, updated: 0, skipped: 0, errors: 0 }
      const records: { line: number; id: string }[] = []
      for (const row of current) {
        if (!('key' in row)) { result.errors++; continue }
        if (row.status === 'skip' || (row.status === 'update' && !update)) { result.skipped++; continue }
        if (!row.apply) throw new HttpError(500, 'SERVER')
        records.push({ line: row.line, id: await row.apply(tx) })
        if (row.status === 'new') result.added++
        else result.updated++
      }
      if (!result.added && !result.updated) throw new HttpError(400, 'BATCH_NO_ROWS', {
        zh: '目前沒有可寫入的列，請檢查預覽或更新選項。', en: 'There are no rows to write. Check the preview or update option.',
      })
      await tx.auditLog.create({
        data: {
          id: batchId, actorId, entityType: 'importBatch', entityId: batchId, action: batchActions[kind],
          summaryZh: `匯入${batchNames[kind][0]}，新增 ${result.added} 筆、更新 ${result.updated} 筆`,
          summaryEn: `Imported ${batchNames[kind][1]}: ${result.added} added, ${result.updated} updated`,
          after: { ...result, records },
        },
      })
      return result
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 45_000 })
  } catch (error) {
    const done = await prisma.auditLog.findFirst({ where: { id: batchId, actorId, action: batchActions[kind] }, select: { after: true } })
    if (done?.after) return res.json(done.after)
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) throw staleError()
    throw error
  }
  previews.delete(batchId)
  res.json(receipt)
}))

router.get('/:kind/history', asyncHandler(async (req, res) => {
  const kind = batchKind.parse(req.params.kind)
  const logs = await prisma.auditLog.findMany({
    where: { action: batchActions[kind], entityType: 'importBatch' }, orderBy: { createdAt: 'desc' }, take: 20,
    select: { id: true, createdAt: true, after: true, actor: { select: { account: true, nameZh: true } } },
  })
  const batches = logs.map(({ id, createdAt, actor, after }) => {
    const { added, updated, skipped, errors } = after as unknown as Receipt
    return { batchId: id, createdAt, actor, added, updated, skipped, errors }
  })
  res.json({ batches })
}))

export default router
