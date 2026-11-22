import type { ConditionKind } from './conditions'

export function showGraduationVerdict(verdict: string) {
  return verdict === 'ready' || verdict === 'pending_review'
}

export type Progress = {
  cohortYear: number | null
  verdict: string
  studyYear: number | null
  earnedTowardTotal: number
  requiredTotal: number | null
  totalConfirmed: boolean
  atRisk: boolean
  delayed: boolean
  categories: { code: string; nameZh: string; nameEn: string; earned: number; requiredCredits: number | null; isPlaceholder: boolean; countsTowardTotal: boolean; met: boolean; minDomains: number | null; domains: number }[]
  thresholds: { id: string; code: string; nameZh: string; nameEn: string; descriptionZh: string; descriptionEn: string; state: string; kind: ConditionKind; isPlaceholder?: boolean; overdue: boolean }[]
  missing: { nameZh: string; nameEn: string }[]
  office: { nameZh: string; nameEn: string }[]
}
