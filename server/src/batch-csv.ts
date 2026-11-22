import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import { z } from 'zod'
import { decodeCsv } from './csv-import'
import { HttpError } from './errors'

export const batchKind = z.enum(['courses', 'classes', 'recognized', 'reviews'])
export type BatchKind = z.infer<typeof batchKind>
export type CsvRow = { line: number; fields: Record<string, string> }
type Column = [key: string, label: string, required?: boolean]

const columns: Record<BatchKind, Column[]> = {
  courses: [
    ['studyYear', '年級', true], ['term', '學期', true], ['nameZh', '科目', true], ['nameEn', '英文科目'],
    ['moduleZh', '課程類別', true], ['moduleEn', '英文類別'], ['requirementType', '修別', true], ['credits', '學分', true],
    ['classHours', '上課時數'], ['practiceHours', '實習時數'], ['noteZh', '備註'], ['noteEn', '英文備註'],
  ],
  classes: [
    ['cohortYear', '入學年度'], ['className', '班級', true], ['advisorAccount', '教師編號'],
    ['studentAccount', '學號'], ['classNameEn', '班級英文'],
  ],
  recognized: [
    ['type', '類型', true], ['nameZh', '名稱', true], ['nameEn', '英文名稱'], ['minScore', '最低分數'],
    ['noteZh', '備註'], ['noteEn', '英文備註'],
  ],
  reviews: [
    ['studentAccount', '學號', true], ['thresholdCode', '門檻代碼', true], ['decision', '審核結果', true],
    ['reviewedAt', '原審核日期', true], ['scoreText', '分數'], ['comment', '審核意見'],
  ],
}

export function batchTemplate(kind: BatchKind) {
  return '\uFEFF' + stringify([columns[kind].map(([, label]) => label)])
}

export function parseBatch(kind: BatchKind, bytes: Buffer): CsvRow[] {
  const config = columns[kind]
  const labels = new Map(config.flatMap(([key, label]) => [[key.toLowerCase(), key], [label, key]]))
  const { text } = decodeCsv(bytes)
  try {
    const entries = parse(text, {
      bom: true,
      trim: true,
      info: true,
      skip_empty_lines: true,
      columns: (headers: string[]) => {
        const keys = headers.map((header) => labels.get(header.trim().toLowerCase()) ?? header.trim())
        const missing = config.filter(([key, , required]) => required && !keys.includes(key)).map(([, label]) => label)
        if (kind === 'classes' && !keys.includes('advisorAccount') && !keys.includes('studentAccount')) missing.push('教師編號／學號')
        if (missing.length) throw new HttpError(400, 'BATCH_COLUMNS', {
          zh: `缺少欄位：${missing.join('、')}。請使用下載的範本。`,
          en: `Missing columns: ${missing.join(', ')}. Use the downloaded template.`,
        })
        if (new Set(keys).size !== keys.length) throw new HttpError(400, 'BATCH_COLUMNS', {
          zh: 'CSV 有重複的欄位名稱，請修正後再上傳。', en: 'The CSV has duplicate column names. Correct them and upload again.',
        })
        return keys.map((key) => config.some(([field]) => field === key) ? key : false)
      },
    }) as { record: Record<string, string>; info: { lines: number } }[]
    if (!entries.length) throw new HttpError(400, 'CSV_EMPTY')
    if (entries.length > 1000) throw new HttpError(400, 'BATCH_TOO_MANY', {
      zh: '單次可匯入 1,000 列，請將檔案分批上傳。', en: 'Each import allows up to 1,000 rows. Split the file into smaller batches.',
    })
    return entries.map(({ record, info }) => ({ line: info.lines, fields: record }))
  } catch (error) {
    if (error instanceof HttpError) throw error
    const line = typeof error === 'object' && error && 'lines' in error && typeof error.lines === 'number' ? error.lines : null
    throw new HttpError(400, 'CSV_PARSE', line === null ? undefined : {
      zh: `CSV 第 ${line} 列無法解析，請檢查欄位數量或引號。`,
      en: `Could not parse CSV line ${line}. Check the column count and quotation marks.`,
    })
  }
}

export function batchErrorReport(rows: { line: number; label: string; messageZh?: string; messageEn?: string }[]) {
  return '\uFEFF' + stringify([
    ['列號', '資料', '說明', 'Details'],
    ...rows.map((row) => [row.line, row.label, row.messageZh ?? '', row.messageEn ?? '']),
  ], { escape_formulas: true })
}
