import fs from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'
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
  return { storageKey, mime: kind.mime, size: buf.length }
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

export function safeDownloadName(name: string) {
  return name.replace(/[\r\n"]/g, '_').slice(0, 180)
}
