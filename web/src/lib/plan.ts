export const planTerms = {
  YEAR_ONLY: 'curriculumYearOnly',
  FULL_YEAR: 'curriculumYearLong',
  FIRST: 'curriculumFirstTerm',
  SECOND: 'curriculumSecondTerm',
  PROGRAM: 'curriculumProgram',
} as const

export const planRequirements = {
  MAJOR_REQUIRED: 'curriculumRequired',
  MAJOR_ELECTIVE: 'curriculumElective',
  LIBERAL: 'curriculumLiberalCredits',
} as const

export type PlanCourse = {
  id: string
  studyYear: number
  term: keyof typeof planTerms
  nameZh: string
  nameEn: string
  moduleZh: string
  moduleEn: string
  requirementType: keyof typeof planRequirements
  credits: number | null
  classHours: number | null
  practiceHours: number | null
  noteZh: string
  noteEn: string
  sort: number
}

const termPriority = { YEAR_ONLY: 0, FULL_YEAR: 0, FIRST: 1, SECOND: 2, PROGRAM: 3 }

export function sortPlan(courses: PlanCourse[]) {
  return [...courses].sort((left, right) =>
    (left.studyYear || 5) - (right.studyYear || 5) ||
    (termPriority[left.term] ?? 0) - (termPriority[right.term] ?? 0) ||
    left.sort - right.sort || left.id.localeCompare(right.id),
  )
}
