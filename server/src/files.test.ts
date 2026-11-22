import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import { displayUploadName, evidenceUploadName, uploadDisposition } from './files'

describe('evidence filenames', () => {
  const original = '英文證明.pdf'

  it('decodes recoverable Latin-1 and Windows-1252 filenames', () => {
    const utf8 = Buffer.from(original)
    const latin1 = utf8.toString('latin1')
    const windows1252 = iconv.decode(utf8, 'windows-1252')
    expect(windows1252).not.toBe(latin1)
    expect(displayUploadName(latin1)).toBe(original)
    expect(displayUploadName(windows1252)).toBe(original)
    expect(displayUploadName('Résumé.pdf')).toBe('Résumé.pdf')
  })

  it('uses the same Unicode name in download metadata', () => {
    const name = evidenceUploadName('B11523001', '英文證明', new Date('2026-11-22T16:00:00.000Z'), 1, 'pdf')
    expect(name).toBe('B11523001_英文證明_20261123-000000_01.pdf')
    const disposition = uploadDisposition(name, false)
    expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/)
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toBe(name)
  })
})
