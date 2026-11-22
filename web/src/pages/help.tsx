import { ChevronDown } from 'lucide-react'
import { useI18n } from '../lib/i18n'
import type { SessionUser } from '../components/shell'

const copy = {
  'zh-Hant': {
    STUDENT: [
      ['我從大一就能用嗎？', '可以。帳號由系辦依學號建立，登入後就看得到你入學年度的規則、學分與四年修課建議。'],
      ['怎麼知道能不能畢業？', '總覽會顯示目前的畢業資格與尚未完成的項目。如需確認完整資格，請洽系辦。'],
      ['證明要傳什麼？', 'PDF、PNG 或 JPEG。英文請從認可清單選檢定並填分數。檔案只在登入且有權限時能預覽。'],
      ['密碼忘了？', '登入頁申請重設，連結只寄到 @nutc.edu.tw，30 分鐘內、只能用一次。'],
    ],
    TEACHER: [
      ['我可以核可學生的證明嗎？', '不行。班導只能看自己班級的進度與文件、留提醒。核可與退回由系上管理員決定。'],
      ['怎麼查看學生還缺哪些項目？', '在「我的班級」選擇班級或搜尋學生。學生卡片會列出尚未完成的項目，點「查看進度」可看明細。'],
      ['看得到別班嗎？', '看不到。系統只回傳你被指派的班級。'],
    ],
    ADMIN: [
      ['如何修改學分要求？', '在畢業規則頁選擇入學年度，點「編輯學分要求」。儲存前先核對變更內容。'],
      ['怎麼整屆建帳？', '使用者頁可單筆建立，或把 CSV 貼進匯入。沒有自助註冊。暫時密碼只顯示一次，也會寄啟動信。'],
      ['預審何時跑？', '預設大四上 9 月 1 日掃該屆。也可以在統計頁手動執行，結果會進學生和班導的通知。'],
      ['個資保存多久？', '停用帳號預設再留 5 年，年數可改。到期後去識別姓名與信箱，並刪除上傳檔，過程寫入稽核。'],
    ],
  },
  en: {
    STUDENT: [
      ['Can I use this as a freshman?', 'Yes. The office creates your ID. From the first login you see your cohort rules, credits, and the four-year map.'],
      ['How do I know if I can graduate?', 'The overview shows your current eligibility and any incomplete requirements. Contact the department office for a full review.'],
      ['What can I upload?', 'PDF, PNG, or JPEG. For English, pick a test from the recognized list and enter the score. Files preview only after an authorization check.'],
      ['I forgot my password.', 'Use the login page. The link goes only to @nutc.edu.tw, expires in 30 minutes, and works once.'],
    ],
    TEACHER: [
      ['Can I approve evidence?', 'No. Advisors view their own classes and can send reminders. Only a department admin can approve or return a file.'],
      ['How do I see what a student still needs?', 'Choose a class or search for a student in My classes. Student cards show incomplete requirements. Select View progress for the details.'],
      ['Can I open another class?', 'No. The server only returns classes assigned to you.'],
    ],
    ADMIN: [
      ['How do I edit credit requirements?', 'On the Rules page, select a cohort and choose Edit credit requirements. Review your changes before saving.'],
      ['How do I add a cohort?', 'Create one account or import CSV. There is no self-registration. The temporary password is shown once and emailed.'],
      ['When does the pre-audit run?', 'By default on 1 September of senior fall. You can also run it from Statistics. Students and advisors get the missing-item list.'],
      ['How long is personal data kept?', 'Deactivated accounts stay for 5 years by default. After that, names and mailboxes are anonymized and uploads deleted. The purge is audited.'],
    ],
  },
} as const

export function HelpPage({ role }: { role: SessionUser['role'] }) {
  const { locale } = useI18n()
  const questions = copy[locale === 'en' ? 'en' : 'zh-Hant'][role]
  return (
    <div className="space-y-4">
      {questions.map(([question, answer], index) => (
        <details key={question} className="card faq-item" open={index === 0 ? true : undefined}>
          <summary>{question}<ChevronDown size={18} aria-hidden /></summary>
          <p className="mt-2 text-sm leading-7 text-ink">{answer}</p>
        </details>
      ))}
    </div>
  )
}
