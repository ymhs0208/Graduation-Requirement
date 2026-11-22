import { describe, expect, it } from 'vitest'
import { inspectEvidence, officialSource, sha256Hex } from './evidence-check'

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)])
}

describe('evidence metadata', () => {
  it('uses only known official verification pages', () => {
    expect(officialSource('全民英檢', 'GEPT')).toBe('https://www.gept.org.tw/')
    expect(officialSource('多益', 'TOEIC')).toBe('https://www.toeic.com.tw/')
    expect(officialSource('托福', 'TOEFL')).toBe('https://www.ets.org/toefl.html')
    expect(officialSource('雅思', 'IELTS')).toBe('https://www.ielts.org/')
    expect(officialSource('自辦檢定', 'Campus test')).toBeNull()
  })

  it('flags an image editor, a late modification, and an unverified signature field', () => {
    const pdf = Buffer.from(`%PDF-1.4
1 0 obj
<< /Producer (Adobe Photoshop) /Creator (Student) /CreationDate (D:20200101120000) /ModDate (D:20240101120000) /Type /Sig /ByteRange [0 10 20 30] >>
endobj
%%EOF`)
    const meta = inspectEvidence(pdf, 'application/pdf')
    expect(meta.sha256).toBe(sha256Hex(pdf))
    expect(meta.producer).toContain('Photoshop')
    expect(meta.editedBySoftware).toBe(true)
    expect(meta.modifiedAfterCreate).toBe(true)
    expect(meta.hasDigitalSignature).toBe(true)
    expect(meta.contentCreatedAt?.toISOString().slice(0, 10)).toBe('2020-01-01')
  })

  it('reads PNG software text without treating a plain file as edited', () => {
    const edited = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', Buffer.alloc(13)),
      chunk('tEXt', Buffer.from('Software\0Canva')),
      chunk('IEND', Buffer.alloc(0)),
    ])
    expect(inspectEvidence(edited, 'image/png').editedBySoftware).toBe(true)
    const plain = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', Buffer.alloc(13)),
      chunk('IEND', Buffer.alloc(0)),
    ])
    const clean = inspectEvidence(plain, 'image/png')
    expect(clean.editedBySoftware).toBe(false)
    expect(clean.hasDigitalSignature).toBe(false)
    expect(clean.modifiedAfterCreate).toBe(false)
  })
})
