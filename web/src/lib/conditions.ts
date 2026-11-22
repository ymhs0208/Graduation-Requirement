export const conditionKinds = { NON_CREDIT: 'conditionRequired', OPTIONAL: 'conditionOptional', INFO: 'conditionInfo' } as const
export type ConditionKind = keyof typeof conditionKinds

export type Condition = {
  id: string
  code: string
  nameZh: string
  nameEn: string
  descriptionZh: string
  descriptionEn: string
  kind: ConditionKind
  isPlaceholder: boolean
}

export function conditionDescription(item: Pick<Condition, 'code' | 'descriptionEn' | 'descriptionZh'>, locale: 'en' | 'zh-Hant', fallback: string) {
  const description = locale === 'en' ? item.descriptionEn : item.descriptionZh
  const legacy = item.code === 'CERTIFICATION'
    ? ['公開網站沒有系訂證照名單。', 'No required certification list was published.']
    : item.code === 'COMPETITION'
      ? ['競賽是否採計由管理員維護的認可清單決定', 'Competitions count only when an admin puts them on the recognized list.']
      : []
  return legacy.some((prefix) => description.startsWith(prefix)) ? fallback : description
}
