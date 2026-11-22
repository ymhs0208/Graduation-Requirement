import { prisma } from './db'

type FileRow = {
  id: string
  sha256: string
  producer: string | null
  creator: string | null
  contentCreatedAt: Date | null
  contentModifiedAt: Date | null
  editedBySoftware: boolean
  modifiedAfterCreate: boolean
  hasDigitalSignature: boolean
}

type Row = {
  id: string
  studentId: string
  certificateNumber: string | null
  issuingBody: string | null
  issuedOn: Date | null
  declaredAt: Date | null
  verifiedAt: Date | null
  verificationMethod: string | null
  verificationNote: string | null
  threshold: { code: string; requiresPaperOriginal: boolean }
  files: FileRow[]
}

export async function adminAuthenticity(rows: Row[]) {
  const hashes = [...new Set(rows.flatMap((row) => row.files.map((file) => file.sha256)).filter(Boolean))]
  const numbers = [...new Set(rows.map((row) => row.certificateNumber).filter((value): value is string => Boolean(value)))]
  const [hashMatches, numberMatches] = await Promise.all([
    hashes.length
      ? prisma.upload.findMany({
          where: { sha256: { in: hashes } },
          select: { sha256: true, submission: { select: { id: true, studentId: true } } },
        })
      : Promise.resolve([]),
    numbers.length
      ? prisma.submission.findMany({
          where: { certificateNumber: { in: numbers } },
          select: { id: true, studentId: true, certificateNumber: true, threshold: { select: { code: true } } },
        })
      : Promise.resolve([]),
  ])
  return new Map(rows.map((row) => {
    const duplicateFile = row.files.some((file) => file.sha256 && hashMatches.some((match) =>
      match.sha256 === file.sha256 && match.submission.studentId !== row.studentId))
    const duplicateCertificate = Boolean(row.certificateNumber) && numberMatches.some((match) =>
      match.certificateNumber === row.certificateNumber && match.studentId !== row.studentId && match.threshold.code === row.threshold.code && match.id !== row.id)
    return [row.id, {
      certificateNumber: row.certificateNumber,
      issuingBody: row.issuingBody,
      issuedOn: row.issuedOn,
      declaredAt: row.declaredAt,
      requiresPaperOriginal: row.threshold.requiresPaperOriginal,
      verified: Boolean(row.verifiedAt),
      verificationMethod: row.verificationMethod,
      verificationNote: row.verificationNote,
      duplicateFile,
      duplicateCertificate,
      files: row.files.map((file) => ({
        id: file.id,
        editedBySoftware: file.editedBySoftware,
        modifiedAfterCreate: file.modifiedAfterCreate,
        hasDigitalSignature: file.hasDigitalSignature,
        signatureVerified: false,
        producer: file.producer,
        creator: file.creator,
        contentCreatedAt: file.contentCreatedAt,
        contentModifiedAt: file.contentModifiedAt,
      })),
    }]
  }))
}
