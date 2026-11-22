import fs from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'
import { isUtf8 } from 'node:buffer'
import iconv from 'iconv-lite'
import { env } from './env'

export function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf' }
  }
  return null
}

export async function saveUpload(buf: Buffer) {
  const kind = sniff(buf)
  if (!kind) return null
  if (buf.length > 8 * 1024 * 1024) return null
  await fs.mkdir(env.uploadDir, { recursive: true })
  const storageKey = `${randomBytes(16).toString('hex')}.${kind.ext}`
  const full = path.resolve(env.uploadDir, storageKey)
  if (!full.startsWith(path.resolve(env.uploadDir) + path.sep)) return null
  await fs.writeFile(full, buf)
  return { storageKey, mime: kind.mime, ext: kind.ext, size: buf.length }
}

export function resolveStored(storageKey: string) {
  if (storageKey.includes('..') || storageKey.includes('/') || storageKey.includes('\\')) return null
  const root = path.resolve(env.uploadDir)
  const full = path.resolve(root, storageKey)
  if (!full.startsWith(root + path.sep)) return null
  return full
}

export async function removeStored(storageKey: string) {
  const full = resolveStored(storageKey)
  if (!full) return
  await fs.rm(full, { force: true })
}

const maxFileNameLength = 180

const uploadTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function uploadNamePart(value: string, fallback: string) {
  return value.replace(/[<>:"/\\|?*\p{Cc}\uD800-\uDFFF]/gu, '-').trim().replace(/^[. ]+|[. ]+$/g, '') || fallback
}

export function evidenceUploadName(account: string, threshold: string, uploadedAt: Date, sequence: number, extension: string) {
  const { year, month, day, hour, minute, second } = Object.fromEntries(
    uploadTime.formatToParts(uploadedAt).map(({ type, value }) => [type, value]),
  )
  const timestamp = `${year}${month}${day}-${hour}${minute}${second}`
  const number = String(sequence).padStart(2, '0')
  return `${uploadNamePart(account, 'student')}_${uploadNamePart(threshold, '證明')}_${timestamp}_${number}.${extension}`
}

export function cleanUploadName(name: string) {
  const clean = name.normalize('NFC').replace(/[<>:"/\\|?*\p{Cc}\uD800-\uDFFF]/gu, '_').trim().replace(/[. ]+$/, '') || 'upload'
  const chars = Array.from(clean)
  if (chars.length <= maxFileNameLength) return clean
  const extension = path.extname(clean)
  if (!/^\.[a-z0-9]{1,10}$/i.test(extension)) return chars.slice(0, maxFileNameLength).join('')
  return chars.slice(0, maxFileNameLength - extension.length).join('') + extension
}

export function displayUploadName(name: string) {
  // Recover UTF-8 header bytes that older clients interpreted as Western text.
  const isLatin1 = /^[\u0000-\u00ff]+$/u.test(name)
  const bytes = isLatin1 ? Buffer.from(name, 'latin1') : iconv.encode(name, 'windows-1252')
  if ((isLatin1 || iconv.decode(bytes, 'windows-1252') === name) && isUtf8(bytes)) {
    const decoded = bytes.toString('utf8')
    if (/[\u0080-\u009f]/u.test(name) || /[\p{Script=Han}\u{10000}-\u{10ffff}]/u.test(decoded)) return cleanUploadName(decoded)
  }
  return cleanUploadName(name)
}

export function uploadDisposition(name: string, inline: boolean) {
  const decoded = displayUploadName(name)
  const fallback = decoded.replace(/[^\x20-\x7e]|["\\%]/g, '_')
  const utf8 = encodeURIComponent(decoded).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${utf8}`
}
