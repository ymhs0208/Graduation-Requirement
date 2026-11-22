import { z } from 'zod'

export const planCourse = z.object({
  studyYear: z.number().int().min(0).max(4),
  term: z.enum(['YEAR_ONLY', 'FULL_YEAR', 'FIRST', 'SECOND', 'PROGRAM']),
  nameZh: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160),
  moduleZh: z.string().trim().min(1).max(120),
  moduleEn: z.string().trim().max(120),
  requirementType: z.enum(['MAJOR_REQUIRED', 'MAJOR_ELECTIVE', 'LIBERAL']),
  credits: z.number().nonnegative().nullable(),
  classHours: z.number().int().min(0).max(2147483647).nullable(),
  practiceHours: z.number().int().min(0).max(2147483647).nullable(),
  noteZh: z.string().trim().max(500),
  noteEn: z.string().trim().max(500),
}).refine((body) => (body.studyYear === 0) === (body.term === 'PROGRAM'))
  .transform((body) => ({
    ...body,
    nameEn: body.nameEn || body.nameZh,
    moduleEn: body.moduleEn || body.moduleZh,
    noteEn: body.noteEn || body.noteZh,
    creditsConfirmed: body.credits !== null,
  }))
