export function officialSource(nameZh: string, nameEn: string) {
  const text = `${nameZh} ${nameEn}`
  if (/GEPT|全民英檢|英檢/i.test(text)) return 'https://www.gept.org.tw/'
  if (/TOEIC|多益/i.test(text)) return 'https://www.toeic.com.tw/'
  if (/TOEFL|托福/i.test(text)) return 'https://www.ets.org/toefl.html'
  if (/IELTS|雅思/i.test(text)) return 'https://www.ielts.org/'
  return null
}
