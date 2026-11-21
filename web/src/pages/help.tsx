import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { SessionUser } from '../components/shell'

const copy = {
  'zh-Hant': {
    STUDENT: [
      ['我從大一就能用嗎？', '可以。帳號由系辦依學號建立，登入後就看得到你入學年度的規則、學分與四年修課建議。'],
      ['怎麼知道能不能畢業？', '總覽最上方會寫可畢業、還有缺項、審核中，或規則尚待系上確認。紅色是未完成，黃色是審核中，綠色是通過。'],
      ['證明要傳什麼？', 'PDF、PNG 或 JPEG。英文請從認可清單選檢定並填分數。檔案只在登入且有權限時能預覽。'],
      ['密碼忘了？', '登入頁申請重設，連結只寄到 @nutc.edu.tw，30 分鐘內、只能用一次。'],
    ],
    TEACHER: [
      ['我可以核可學生的證明嗎？', '不行。班導只能看自己班級的進度與文件、留提醒。核可與退回由系上管理員決定。'],
      ['怎麼找可能畢不了業的學生？', '班級頁勾選「進度落後」，會列出逾期門檻、學分節奏落後或已超過四年仍未達標的人。'],
      ['看得到別班嗎？', '看不到。系統只回傳你被指派的班級。'],
    ],
    ADMIN: [
      ['規則為什麼有待確認？', '110 與 115 的學分來自教務系統。111 到 114 的頁面這次沒取回，系訂門檻第七點網站沒有全文，所以先標成可改的占位。'],
      ['怎麼整屆建帳？', '使用者頁可單筆建立，或把 CSV 貼進匯入。沒有自助註冊。暫時密碼只顯示一次，也會寄啟動信。'],
      ['預審何時跑？', '預設大四上 9 月 1 日掃該屆。也可以在統計頁手動執行，結果會進學生和班導的通知。'],
      ['個資保存多久？', '停用帳號預設再留 5 年，年數可改。到期後去識別姓名與信箱，並刪除上傳檔，過程寫入稽核。'],
    ],
  },
  en: {
    STUDENT: [
      ['Can I use this as a freshman?', 'Yes. The office creates your ID. From the first login you see your cohort rules, credits, and the four-year map.'],
      ['How do I know if I can graduate?', 'The overview says ready, missing items, in review, or waiting on the office. Red is missing, amber is in review, green is passed.'],
      ['What can I upload?', 'PDF, PNG, or JPEG. For English, pick a test from the recognized list and enter the score. Files preview only after an authorization check.'],
      ['I forgot my password.', 'Use the login page. The link goes only to @nutc.edu.tw, expires in 30 minutes, and works once.'],
    ],
    TEACHER: [
      ['Can I approve evidence?', 'No. Advisors view their own classes and can send reminders. Only a department admin can approve or return a file.'],
      ['Who looks unlikely to graduate?', 'Turn on Behind. It lists overdue thresholds, a slow credit pace, or students past four years who are not ready.'],
      ['Can I open another class?', 'No. The server only returns classes assigned to you.'],
    ],
    ADMIN: [
      ['Why are some numbers unconfirmed?', 'Cohorts 110 and 115 come from the academic system. Cohorts 111–114 were not retrieved, and article 7 of the department rule was not published, so those stay editable placeholders.'],
      ['How do I add a cohort?', 'Create one account or import CSV. There is no self-registration. The temporary password is shown once and emailed.'],
      ['When does the pre-audit run?', 'By default on 1 September of senior fall. You can also run it from Statistics. Students and advisors get the missing-item list.'],
      ['How long is personal data kept?', 'Deactivated accounts stay for 5 years by default. After that, names and mailboxes are anonymized and uploads deleted. The purge is audited.'],
    ],
  },
} as const

export function HelpPage({ role }: { role: SessionUser['role'] }) {
  const { locale, t } = useI18n()
  const questions = copy[locale === 'en' ? 'en' : 'zh-Hant'][role]
  useQuery({ queryKey: ['me-help'], queryFn: () => api('/api/auth/me') })
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('help')}</h1>
      <p className="text-stone-600 dark:text-stone-300">{t('helpLead')}</p>
      {questions.map(([question, answer]) => (
        <article key={question} className="rounded-2xl bg-white p-4 dark:bg-zinc-900">
          <h2 className="font-medium">{question}</h2>
          <p className="mt-1 text-sm leading-6">{answer}</p>
        </article>
      ))}
    </div>
  )
}
