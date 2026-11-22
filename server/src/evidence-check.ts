import { createHash } from 'crypto'

const EDITORS = /photoshop|gimp|canva|pixelmator|affinity photo|paint\.net|snapseed|meitu|美圖|picsart|illustrator|inkscape|lightroom|coreldraw|corel draw|photopea|fotor/i
const DAY_MS = 24 * 60 * 60 * 1000

export type EvidenceMeta = {
  sha256: string
  producer: string | null
  creator: string | null
  contentCreatedAt: Date | null
  contentModifiedAt: Date | null
  editedBySoftware: boolean
  modifiedAfterCreate: boolean
  hasDigitalSignature: boolean
}

export function sha256Hex(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex')
}

export function officialSource(nameZh: string, nameEn: string) {
  const text = `${nameZh} ${nameEn}`
  if (/GEPT|全民英檢|英檢/i.test(text)) return 'https://www.gept.org.tw/'
  if (/TOEIC|多益/i.test(text)) return 'https://www.toeic.com.tw/'
  if (/TOEFL|托福/i.test(text)) return 'https://www.ets.org/toefl.html'
  if (/IELTS|雅思/i.test(text)) return 'https://www.ielts.org/'
  return null
}

export function inspectEvidence(buf: Buffer, mime: string): EvidenceMeta {
  const sha256 = sha256Hex(buf)
  const limited = buf.subarray(0, Math.min(buf.length, 1_500_000))
  let producer: string | null = null
  let creator: string | null = null
  let contentCreatedAt: Date | null = null
  let contentModifiedAt: Date | null = null
  let hasDigitalSignature = false
  try {
    if (mime.includes('pdf') || limited.subarray(0, 5).toString('latin1') === '%PDF-') {
      const text = limited.toString('latin1')
      producer = pdfValue(text, 'Producer')
      creator = pdfValue(text, 'Creator')
      contentCreatedAt = pdfDate(pdfValue(text, 'CreationDate'))
      contentModifiedAt = pdfDate(pdfValue(text, 'ModDate'))
      hasDigitalSignature = /\/Type\s*\/Sig\b|\/FT\s*\/Sig\b|\/ByteRange\s*\[/.test(text)
    } else if (mime.includes('png') || (limited[0] === 0x89 && limited[1] === 0x50)) {
      const png = pngText(limited)
      producer = png.software
      contentCreatedAt = png.created
      contentModifiedAt = png.modified
    } else if (mime.includes('jpeg') || mime.includes('jpg') || limited[0] === 0xff) {
      const jpeg = jpegExif(limited)
      producer = jpeg.software
      contentCreatedAt = jpeg.created
      contentModifiedAt = jpeg.modified
    }
  } catch {
    producer = producer ?? null
  }
  const software = `${producer ?? ''} ${creator ?? ''}`
  const editedBySoftware = EDITORS.test(software)
  const modifiedAfterCreate = Boolean(
    contentCreatedAt && contentModifiedAt && contentModifiedAt.getTime() - contentCreatedAt.getTime() > DAY_MS,
  )
  return { sha256, producer, creator, contentCreatedAt, contentModifiedAt, editedBySoftware, modifiedAfterCreate, hasDigitalSignature }
}

function pdfValue(text: string, key: string) {
  const literal = new RegExp(`/${key}\\s*\\((?:\\\\.|[^)]){0,300}\\)`)
  const found = literal.exec(text)
  if (found) {
    const raw = found[0].slice(found[0].indexOf('(') + 1, -1)
    return raw.replace(/\\([()\\])/g, '$1').replace(/\\n/g, ' ').slice(0, 180)
  }
  const hex = new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]{2,400})>`)
  const hexFound = hex.exec(text)
  if (!hexFound) return null
  const bytes = hexFound[1].replace(/\s/g, '')
  if (bytes.length % 2) return null
  return Buffer.from(bytes, 'hex').toString('latin1').replace(/\0/g, '').slice(0, 180) || null
}

function pdfDate(value: string | null) {
  if (!value) return null
  const match = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value)
  if (!match) return null
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00'] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)))
  return Number.isNaN(date.getTime()) ? null : date
}

function pngText(buf: Buffer) {
  let software: string | null = null
  let created: Date | null = null
  let modified: Date | null = null
  let offset = 8
  for (let chunks = 0; chunks < 48 && offset + 12 <= buf.length; chunks += 1) {
    const length = buf.readUInt32BE(offset)
    if (length > 1_000_000 || offset + 12 + length > buf.length) break
    const type = buf.toString('ascii', offset + 4, offset + 8)
    if (type === 'tEXt' || type === 'iTXt') {
      const data = buf.subarray(offset + 8, offset + 8 + Math.min(length, 2000))
      const split = data.indexOf(0)
      const key = data.subarray(0, split === -1 ? data.length : split).toString('latin1')
      const value = data.subarray(split + 1).toString('latin1').replace(/\0/g, '').slice(0, 180)
      if (/software|author|creator/i.test(key)) software = value
      if (/creation/i.test(key)) created = new Date(value)
      if (/modif/i.test(key)) modified = new Date(value)
      if (created && Number.isNaN(created.getTime())) created = null
      if (modified && Number.isNaN(modified.getTime())) modified = null
    }
    if (type === 'IEND') break
    offset += 12 + length
  }
  return { software, created, modified }
}

function jpegExif(buf: Buffer) {
  let software: string | null = null
  let created: Date | null = null
  let modified: Date | null = null
  let offset = 2
  while (offset + 4 < buf.length && offset < 700_000) {
    if (buf[offset] !== 0xff) break
    const marker = buf[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    const length = buf.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > buf.length) break
    if (marker === 0xe1 && buf.toString('ascii', offset + 4, offset + 10) === 'Exif\0\0') {
      const parsed = readExif(buf.subarray(offset + 10, offset + 2 + length))
      software = parsed.software
      created = parsed.created
      modified = parsed.modified
      break
    }
    offset += 2 + length
  }
  return { software, created, modified }
}

function readExif(buf: Buffer) {
  let software: string | null = null
  let created: Date | null = null
  let modified: Date | null = null
  if (buf.length < 8) return { software, created, modified }
  const little = buf.toString('ascii', 0, 2) === 'II'
  const read16 = (at: number) => (little ? buf.readUInt16LE(at) : buf.readUInt16BE(at))
  const read32 = (at: number) => (little ? buf.readUInt32LE(at) : buf.readUInt32BE(at))
  if (offsetSafe(buf, 4, 4) && read16(2) !== 42) return { software, created, modified }
  const start = read32(4)
  if (!offsetSafe(buf, start, 2)) return { software, created, modified }
  const count = Math.min(read16(start), 64)
  for (let index = 0; index < count; index += 1) {
    const entry = start + 2 + index * 12
    if (!offsetSafe(buf, entry, 12)) break
    const tag = read16(entry)
    const type = read16(entry + 2)
    const values = read32(entry + 4)
    if (type !== 2 || values < 2 || values > 180) continue
    const at = values <= 4 ? entry + 8 : read32(entry + 8)
    if (!offsetSafe(buf, at, values)) continue
    const text = buf.toString('latin1', at, at + values - 1).replace(/\0/g, '')
    if (tag === 0x0131) software = text
    if (tag === 0x0132) modified = exifDate(text)
    if (tag === 0x9003) created = exifDate(text)
  }
  return { software, created, modified }
}

function exifDate(value: string) {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]))
  return Number.isNaN(date.getTime()) ? null : date
}

function offsetSafe(buf: Buffer, offset: number, length: number) {
  return offset >= 0 && length >= 0 && offset + length <= buf.length
}
