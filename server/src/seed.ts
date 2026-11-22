import fs from 'fs/promises'
import path from 'path'
import { prisma } from './db'
import { hashPassword } from './crypto'
import { saveUpload } from './files'
import { DEMO_ADMIN_TOTP, DEMO_PASSWORD } from './demo'
import { initialCurriculum115 } from './curriculum-115'
import { env } from './env'

const SRC = {
  aisap110: 'https://aisap.nutc.edu.tw/public/day/std_dep_course.aspx?sch_type=4&dep=267&yy=110',
  aisap115: 'https://aisap.nutc.edu.tw/public/day/std_dep_course.aspx?_p=2',
  coursePage: 'https://ai.nutc.edu.tw/p/412-1067-13324.php',
  englishRule: 'https://language.nutc.edu.tw/var/file/79/1079/img/3036/125461901.pdf',
  englishTable: 'https://language.nutc.edu.tw/var/file/79/1079/img/3036/300875693.pdf',
  map: 'https://ai.nutc.edu.tw/p/404-1067-76129.php?Lang=zh-tw',
  school: 'https://ai.nutc.edu.tw/var/file/67/1067/img/3580/620887369.pdf',
  intern: 'https://ai.nutc.edu.tw/var/file/67/1067/img/3445/391283174.pdf',
  service: 'https://csc.nutc.edu.tw/var/file/28/1028/img/331488135.pdf',
}

type PlanRow = [number, string, string, string, string, string]

const PLAN: PlanRow[] = [
  [1, '專業課程', 'Core', 'COLLEGE_REQUIRED', '微積分(1)(2)', 'Calculus (1)(2)'],
  [1, '專業課程', 'Core', 'COLLEGE_REQUIRED', '計算機概論', 'Introduction to Computers'],
  [1, '專業課程', 'Core', 'MAJOR_REQUIRED', '程式設計', 'Programming'],
  [1, '專業課程', 'Core', 'MAJOR_REQUIRED', '人工智慧程式設計', 'AI Programming'],
  [1, '專業課程', 'Core', 'MAJOR_ELECTIVE', '資訊安全', 'Information Security'],
  [1, '智慧運算模組', 'Intelligent Computing', 'MAJOR_REQUIRED', '人工智慧概論', 'Introduction to AI'],
  [1, '智慧感知模組', 'Intelligent Sensing', 'MAJOR_REQUIRED', '計算機網路工程', 'Computer Networks'],
  [1, '智慧感知模組', 'Intelligent Sensing', 'MAJOR_ELECTIVE', '微處理機設計', 'Microprocessor Design'],
  [1, '人機互動模組', 'HCI', 'MAJOR_REQUIRED', '人因工程概論', 'Introduction to Human Factors'],
  [2, '專業課程', 'Core', 'MAJOR_REQUIRED', '機率與統計', 'Probability and Statistics'],
  [2, '專業課程', 'Core', 'MAJOR_REQUIRED', '資料結構', 'Data Structures'],
  [2, '專業課程', 'Core', 'MAJOR_ELECTIVE', '工程數學', 'Engineering Mathematics'],
  [2, '專業課程', 'Core', 'MAJOR_ELECTIVE', '線性代數', 'Linear Algebra'],
  [2, '專業課程', 'Core', 'MAJOR_REQUIRED', '資料庫系統', 'Database Systems'],
  [2, '專業課程', 'Core', 'MAJOR_ELECTIVE', '訊號處理', 'Signal Processing'],
  [2, '智慧運算模組', 'Intelligent Computing', 'MAJOR_REQUIRED', '資料科學', 'Data Science'],
  [2, '智慧運算模組', 'Intelligent Computing', 'MAJOR_ELECTIVE', '區塊鏈', 'Blockchain'],
  [2, '智慧運算模組', 'Intelligent Computing', 'MAJOR_ELECTIVE', '資料探勘', 'Data Mining'],
  [2, '智慧運算模組', 'Intelligent Computing', 'MAJOR_ELECTIVE', '網站後端開發', 'Web Backend Development'],
  [2, '智慧感知模組', 'Intelligent Sensing', 'MAJOR_REQUIRED', '智慧裝置嵌入式系統實務', 'Embedded Systems for Smart Devices'],
  [2, '智慧感知模組', 'Intelligent Sensing', 'COLLEGE_REQUIRED', '物聯網概論', 'Introduction to IoT'],
  [2, '智慧感知模組', 'Intelligent Sensing', 'MAJOR_ELECTIVE', '網路程式設計', 'Network Programming'],
  [2, '人機互動模組', 'HCI', 'MAJOR_REQUIRED', '智慧人機互動設計', 'Intelligent HCI Design'],
  [2, '人機互動模組', 'HCI', 'MAJOR_ELECTIVE', '網站前端設計', 'Web Frontend Design'],
  [2, '人機互動模組', 'HCI', 'MAJOR_REQUIRED', '資料視覺化', 'Data Visualization'],
  [2, '跨領域課程', 'Cross-domain', 'MAJOR_ELECTIVE', '金融科技', 'Financial Technology'],
  [2, '跨領域課程', 'Cross-domain', 'MAJOR_ELECTIVE', '醫學護理資訊學', 'Medical and Nursing Informatics'],
  [2, '跨領域課程', 'Cross-domain', 'MAJOR_ELECTIVE', '生物科技概論', 'Introduction to Biotechnology'],
  [3, '專業課程', 'Core', 'MAJOR_REQUIRED', '實務專題(1)(2)', 'Capstone (1)(2)'],
  [3, '專業課程', 'Core', 'MAJOR_ELECTIVE', '作業系統', 'Operating Systems'],
  [3, '專業課程', 'Core', 'MAJOR_ELECTIVE', '離散數學', 'Discrete Mathematics'],
  [3, '專業課程', 'Core', 'MAJOR_ELECTIVE', '演算法', 'Algorithms'],
  [3, '智慧運算模組', 'Intelligent Computing', 'MAJOR_REQUIRED', '機器學習實務', 'Machine Learning Practice'],
  [3, '智慧運算模組', 'Intelligent Computing', 'MAJOR_ELECTIVE', '電腦視覺', 'Computer Vision'],
  [3, '智慧運算模組', 'Intelligent Computing', 'MAJOR_ELECTIVE', '自然語言處理', 'Natural Language Processing'],
  [3, '智慧運算模組', 'Intelligent Computing', 'MAJOR_ELECTIVE', '深度學習實務', 'Deep Learning Practice'],
  [3, '智慧運算模組', 'Intelligent Computing', 'MAJOR_ELECTIVE', '語音訊號處理', 'Speech Signal Processing'],
  [3, '智慧感知模組', 'Intelligent Sensing', 'MAJOR_REQUIRED', '雲端物聯網開發', 'Cloud IoT Development'],
  [3, '智慧感知模組', 'Intelligent Sensing', 'MAJOR_ELECTIVE', '機器人開發實務', 'Robotics Practice'],
  [3, '人機互動模組', 'HCI', 'MAJOR_ELECTIVE', '價值主張設計', 'Value Proposition Design'],
  [3, '人機互動模組', 'HCI', 'MAJOR_ELECTIVE', '智慧設計運算', 'Intelligent Design Computing'],
  [3, '跨領域課程', 'Cross-domain', 'MAJOR_ELECTIVE', '醫療科技評估', 'Health Technology Assessment'],
  [3, '跨領域課程', 'Cross-domain', 'MAJOR_ELECTIVE', '智慧農業', 'Smart Agriculture'],
  [3, '跨領域課程', 'Cross-domain', 'MAJOR_ELECTIVE', '精準行銷', 'Precision Marketing'],
  [4, '專業課程', 'Core', 'MAJOR_ELECTIVE', '實務專題(3)', 'Capstone (3)'],
  [4, '專業課程', 'Core', 'MAJOR_ELECTIVE', '圖形理論', 'Graph Theory'],
  [4, '專業課程', 'Core', 'MAJOR_ELECTIVE', '校外實習(1)(2)', 'Off-campus Internship (1)(2)'],
  [4, '智慧運算模組', 'Intelligent Computing', 'MAJOR_ELECTIVE', '進階深度學習', 'Advanced Deep Learning'],
  [4, '智慧運算模組', 'Intelligent Computing', 'MAJOR_ELECTIVE', '情意計算', 'Affective Computing'],
  [4, '智慧運算模組', 'Intelligent Computing', 'MAJOR_ELECTIVE', '社群媒體分析', 'Social Media Analytics'],
  [4, '智慧感知模組', 'Intelligent Sensing', 'MAJOR_ELECTIVE', '工業物聯網', 'Industrial IoT'],
  [4, '智慧感知模組', 'Intelligent Sensing', 'MAJOR_ELECTIVE', '虛實整合系統', 'Cyber-physical Systems'],
  [4, '人機互動模組', 'HCI', 'MAJOR_ELECTIVE', '使用者體驗設計', 'User Experience Design'],
  [4, '人機互動模組', 'HCI', 'MAJOR_ELECTIVE', 'AI電腦應用', 'AI Computer Applications'],
  [4, '跨領域課程', 'Cross-domain', 'MAJOR_ELECTIVE', '創新與創業設計', 'Innovation and Entrepreneurship'],
  [4, '跨領域課程', 'Cross-domain', 'MAJOR_ELECTIVE', '商業設計', 'Commercial Design'],
]

const planNoteZh = '課名轉錄自學程課程地圖（單張圖，未標入學年度、未標學分、未分上下學期）。學分欄位留空，請管理員依教務系統科目明細補正。'
const planNoteEn = 'Course names were transcribed from the single curriculum-map image. It has no cohort year, no credits, and no semester split. Credit values stay empty until an admin confirms them.'

export async function seed() {
  await prisma.upload.deleteMany()
  await prisma.submission.deleteMany()
  await prisma.comment.deleteMany()
  await prisma.creditRecord.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.emailLog.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.session.deleteMany()
  await prisma.passwordReset.deleteMany()
  await prisma.preAuditRun.deleteMany()
  await prisma.planItem.deleteMany()
  await prisma.threshold.deleteMany()
  await prisma.creditCategory.deleteMany()
  await prisma.ruleSet.deleteMany()
  await prisma.recognizedItem.deleteMany()
  await prisma.user.updateMany({ data: { classId: null } })
  await prisma.class.updateMany({ data: { advisorId: null } })
  await prisma.class.deleteMany()
  await prisma.user.deleteMany()
  await prisma.appSetting.deleteMany()
  await prisma.retentionPolicy.deleteMany()

  const [adminHash, teacherHash, studentHash, initHash] = await Promise.all([
    hashPassword(DEMO_PASSWORD.admin),
    hashPassword(DEMO_PASSWORD.teacher),
    hashPassword(DEMO_PASSWORD.student),
    hashPassword(DEMO_PASSWORD.firstLogin),
  ])

  const admin = await prisma.user.create({
    data: {
      account: 'A0001',
      email: 'a0001@nutc.edu.tw',
      nameZh: '周書涵',
      nameEn: 'Chou Shu-Han',
      passwordHash: adminHash,
      role: 'ADMIN',
      totpSecret: DEMO_ADMIN_TOTP,
      totpEnabled: true,
      onboardingCompleted: true,
    },
  })
  const teacherA = await prisma.user.create({
    data: {
      account: 'T1001',
      email: 't1001@nutc.edu.tw',
      nameZh: '王雅婷',
      nameEn: 'Wang Ya-Ting',
      passwordHash: teacherHash,
      role: 'TEACHER',
      onboardingCompleted: true,
    },
  })
  const teacherB = await prisma.user.create({
    data: {
      account: 'T1002',
      email: 't1002@nutc.edu.tw',
      nameZh: '李承恩',
      nameEn: 'Li Cheng-En',
      passwordHash: teacherHash,
      role: 'TEACHER',
      onboardingCompleted: true,
    },
  })

  const classDelay = await prisma.class.create({ data: { nameZh: '智應延畢', nameEn: 'AI Delayed', cohortYear: 110, advisorId: teacherA.id } })
  const class4 = await prisma.class.create({ data: { nameZh: '智應四甲', nameEn: 'AI Year 4 A', cohortYear: 112, advisorId: teacherA.id } })
  const class3 = await prisma.class.create({ data: { nameZh: '智應三甲', nameEn: 'AI Year 3 A', cohortYear: 113, advisorId: teacherA.id } })
  const class1 = await prisma.class.create({ data: { nameZh: '智應一甲', nameEn: 'AI Year 1 A', cohortYear: 115, advisorId: teacherB.id } })

  async function student(data: {
    account: string
    nameZh: string
    nameEn: string
    cohortYear: number
    classId: string
    passwordHash?: string
    mustChangePassword?: boolean
    onboardingCompleted?: boolean
    status?: string
    deactivationReason?: string
  }) {
    return prisma.user.create({
      data: {
        account: data.account,
        email: `${data.account.toLowerCase()}@nutc.edu.tw`,
        nameZh: data.nameZh,
        nameEn: data.nameEn,
        passwordHash: data.passwordHash ?? studentHash,
        role: 'STUDENT',
        cohortYear: data.cohortYear,
        classId: data.classId,
        mustChangePassword: data.mustChangePassword ?? false,
        onboardingCompleted: data.onboardingCompleted ?? true,
        status: data.status ?? 'ACTIVE',
        deactivationReason: data.deactivationReason,
        deactivatedAt: data.status === 'DEACTIVATED' ? new Date('2026-06-30') : null,
      },
    })
  }

  const lin = await student({ account: 'B11023008', nameZh: '林可芯', nameEn: 'Lin Ke-Xin', cohortYear: 110, classId: classDelay.id })
  const wu = await student({ account: 'B11023015', nameZh: '吳承恩', nameEn: 'Wu Cheng-En', cohortYear: 110, classId: classDelay.id })
  const chen = await student({ account: 'B11223001', nameZh: '陳思妤', nameEn: 'Chen Si-Yu', cohortYear: 112, classId: class4.id })
  const hsu = await student({ account: 'B11223014', nameZh: '許柏宇', nameEn: 'Hsu Bo-Yu', cohortYear: 112, classId: class4.id })
  const huang = await student({ account: 'B11323003', nameZh: '黃品叡', nameEn: 'Huang Pin-Rui', cohortYear: 113, classId: class3.id })
  const chang = await student({ account: 'B11523001', nameZh: '張安然', nameEn: 'Chang An-Ran', cohortYear: 115, classId: class1.id, onboardingCompleted: false })
  await student({
    account: 'B11523099',
    nameZh: '簡以安',
    nameEn: 'Chien Yi-An',
    cohortYear: 115,
    classId: class1.id,
    passwordHash: initHash,
    mustChangePassword: true,
    onboardingCompleted: false,
  })
  await student({
    account: 'B11023021',
    nameZh: '蔡明哲',
    nameEn: 'Tsai Ming-Che',
    cohortYear: 110,
    classId: classDelay.id,
    status: 'DEACTIVATED',
    deactivationReason: 'GRADUATED',
  })

  for (const year of [110, 111, 112, 113, 114, 115]) {
    const confirmed = year === 110 || year === 115
    const required = year === 115 ? 90 : year === 110 ? 89 : null
    const elective = year === 115 ? 32 : year === 110 ? 33 : null
    const rule = await prisma.ruleSet.create({
      data: {
        cohortYear: year,
        totalCredits: confirmed ? 130 : null,
        totalCreditsConfirmed: confirmed,
        summaryZh: confirmed
          ? `${year} 學年度課程標準：畢業總學分 130。校級四年制最低為 128，本學程以課程標準 130 為準。英文門檻為 A 組。系訂門檻條文未在網站找到。`
          : `${year} 學年度課程標準頁有連結，但這次沒有取回學分欄。數字標成待確認，請管理員核對教務系統後填上。英文門檻仍依語言中心 A 組規定。`,
        summaryEn: confirmed
          ? `Cohort ${year} curriculum standard: 130 credits. The university floor for a four-year program is 128. English is group A. The department threshold text was not published.`
          : `Cohort ${year} has a curriculum-standard link, but the credit columns were not retrieved. Numbers stay unconfirmed. The English rule still follows language-center group A.`,
        sourceNoteZh: `來源：${confirmed ? (year === 110 ? SRC.aisap110 : SRC.aisap115) : SRC.coursePage}；學則 ${SRC.school}`,
        sourceNoteEn: `Sources: ${confirmed ? (year === 110 ? SRC.aisap110 : SRC.aisap115) : SRC.coursePage}; academic regulations ${SRC.school}`,
      },
    })
    const categories = [
      ['MAJOR_REQUIRED', '必修', 'Required credits', required, true, null, 1],
      ['ELECTIVE', '選修', 'Elective credits', elective, true, null, 2],
      ['CROSS_DEPT', '跨系選修（選修內下限）', 'Cross-department electives (minimum inside electives)', confirmed ? 16 : null, false, null, 3],
      ['LIBERAL', '博雅通識', 'Liberal arts', confirmed ? 8 : null, true, confirmed ? 4 : null, 4],
    ] as const
    for (const [code, nameZh, nameEn, credits, counts, domains, sort] of categories) {
      await prisma.creditCategory.create({
        data: {
          ruleSetId: rule.id,
          code,
          nameZh,
          nameEn,
          requiredCredits: credits,
          countsTowardTotal: counts,
          minDomains: domains,
          isPlaceholder: !confirmed,
          noteZh: !confirmed
            ? '待管理員依教務系統更新。跨系 16 學分在已確認年度是選修中的下限，不另加進總學分。'
            : code === 'CROSS_DEPT'
              ? '課程標準把跨系選修另列。89/90+選修+博雅 8 等於 130，因此跨系學分不重複計入總學分，僅檢查是否達到 16。'
              : code === 'LIBERAL'
                ? '博雅通識 8 學分／4 領域，計入畢業總學分。'
                : '數字來自教務系統課程標準摘要。',
          noteEn: !confirmed
            ? 'An admin must fill this from the academic system. Where confirmed, cross-department credits are a minimum inside electives and are not added again to the total.'
            : code === 'CROSS_DEPT'
              ? 'Cross-department credits are listed separately. Required + elective + 8 liberal-arts credits equal 130, so these 16 credits are a minimum, not an extra block.'
              : 'Taken from the academic-system curriculum summary.',
          sort,
        },
      })
    }
    if (year >= 113) {
      await prisma.creditCategory.create({
        data: {
          ruleSetId: rule.id,
          code: 'SERVICE',
          nameZh: '服務與學習',
          nameEn: 'Service learning',
          requiredCredits: 1,
          countsTowardTotal: false,
          isPlaceholder: false,
          noteZh: '113 學年度起日間部四技一年級必修 1 學分，不及格須重修至及格才能畢業。課程標準未說明是否已含在 130 學分內，故不計入總學分。',
          noteEn: 'From academic year 113, day-division freshmen must pass 1 service-learning credit. Whether it sits inside the 130 is not stated, so it is tracked separately.',
          sort: 5,
        },
      })
    }
    const thresholds = [
      {
        code: 'ENGLISH',
        nameZh: '英文能力門檻',
        nameEn: 'English proficiency',
        descriptionZh: 'A 組：全民英檢中級複試、新制多益 550、TOEFL ITP 460、TOEFL iBT 42、IELTS 4、校內英檢 550，或其他經核定之同等級證明。修畢規定輔導課程且及格視同通過。',
        descriptionEn: 'Group A: GEPT intermediate second stage, TOEIC 550, TOEFL ITP 460, TOEFL iBT 42, IELTS 4, campus test 550, or an approved equivalent. A passed remedial course also counts.',
        kind: 'NON_CREDIT',
        isPlaceholder: false,
        sourceUrl: SRC.englishRule,
        deadlineYear: 2,
        deadlineSemester: 2,
        sort: 1,
      },
      {
        code: 'DEPT_CUSTOM',
        nameZh: '系訂畢業門檻',
        nameEn: 'Department threshold',
        descriptionZh: '教務系統要學生詳閱「日間部學生畢業資格審查作業要點」第七點。學程規章頁沒有這份全文，條文待系辦貼上後才列為正式門檻。',
        descriptionEn: 'The academic system points to article 7 of the department graduation-review guidelines. That text is not on the program site, so this stays unpublished until the office pastes it.',
        kind: 'NON_CREDIT',
        isPlaceholder: true,
        sourceUrl: year === 110 ? SRC.aisap110 : SRC.aisap115,
        deadlineYear: 4,
        deadlineSemester: 1,
        sort: 2,
      },
      {
        code: 'CERTIFICATION',
        nameZh: '專業證照',
        nameEn: 'Professional certification',
        descriptionZh: '公開網站沒有系訂證照名單。管理員維護認可清單後，學生才能選證照上傳。未列入之前，這項不擋畢業。',
        descriptionEn: 'No required certification list was published. Students can upload only after an admin adds recognized certificates. Until then this does not block graduation.',
        kind: 'OPTIONAL',
        isPlaceholder: false,
        sourceUrl: null,
        deadlineYear: null,
        deadlineSemester: null,
        sort: 3,
      },
      {
        code: 'COMPETITION',
        nameZh: '競賽',
        nameEn: 'Competition',
        descriptionZh: '競賽是否採計由管理員維護的認可清單決定，預設不擋畢業。',
        descriptionEn: 'Competitions count only when an admin puts them on the recognized list. They do not block graduation by default.',
        kind: 'OPTIONAL',
        isPlaceholder: false,
        sourceUrl: null,
        deadlineYear: null,
        deadlineSemester: null,
        sort: 4,
      },
      {
        code: 'INTERNSHIP',
        nameZh: '校外實習（選修）',
        nameEn: 'Internship (elective)',
        descriptionZh: '實習作業要點規定合格可抵免選修實習學分，不是人人必做的非學分門檻。暑期 2 學分／至少 320 小時，學期 9 學分，其他 6 學分／至少 480 小時。',
        descriptionEn: 'The internship guideline lets a passed placement waive elective internship credits. It is not a universal non-credit gate.',
        kind: 'INFO',
        isPlaceholder: false,
        sourceUrl: SRC.intern,
        deadlineYear: 4,
        deadlineSemester: null,
        sort: 5,
      },
    ]
    if (year >= 113) {
      thresholds.push({
        code: 'SERVICE',
        nameZh: '服務與學習證明',
        nameEn: 'Service-learning record',
        descriptionZh: '須及格。可由成績（服務與學習 1 學分）或上傳證明經管理員核可。',
        descriptionEn: 'Must be passed, either as the 1-credit course or as an admin-approved upload.',
        kind: 'NON_CREDIT',
        isPlaceholder: false,
        sourceUrl: SRC.service,
        deadlineYear: 1,
        deadlineSemester: 2,
        sort: 6,
      })
    }
    for (const threshold of thresholds) {
      await prisma.threshold.create({ data: { ruleSetId: rule.id, ...threshold } })
    }
    if (year === 115) {
      await prisma.planItem.createMany({ data: initialCurriculum115.map((item) => ({ ...item, ruleSetId: rule.id })) })
      continue
    }
    let sort = 0
    for (const row of PLAN) {
      sort += 1
      await prisma.planItem.create({
        data: {
          ruleSetId: rule.id,
          studyYear: row[0],
          moduleZh: row[1],
          moduleEn: row[2],
          requirementType: row[3],
          nameZh: row[4],
          nameEn: row[5],
          creditsConfirmed: false,
          sourceNoteZh: planNoteZh,
          sourceNoteEn: planNoteEn,
          sort,
        },
      })
    }
  }

  const englishItems = [
    ['全民英檢 GEPT 中級複試以上', 'GEPT intermediate second stage or higher', null, '通過等級', 'Level'],
    ['新制多益 TOEIC', 'TOEIC Listening & Reading', 550, '分數', 'Score'],
    ['托福紙筆 TOEFL ITP', 'TOEFL ITP', 460, '分數', 'Score'],
    ['托福網路 TOEFL iBT', 'TOEFL iBT', 42, '分數', 'Score'],
    ['雅思 IELTS', 'IELTS', 4, '級分', 'Band'],
    ['校內英文能力檢定', 'On-campus English test', 550, '分數', 'Score'],
    ['英文檢定輔導課程及格', 'Passed remedial English course', 60, '成績', 'Grade'],
  ] as const
  for (const item of englishItems) {
    await prisma.recognizedItem.create({
      data: {
        type: 'ENGLISH',
        nameZh: item[0],
        nameEn: item[1],
        minScore: item[2],
        scoreLabelZh: item[3],
        scoreLabelEn: item[4],
        countsAsPass: true,
        sourceUrl: SRC.englishTable,
        noteZh: '語言中心 A 組標準，114.09.16 對照表將本學程四技列為 550。管理員可改門檻。',
        noteEn: 'Language-center group A. The 2025-09-16 table lists this program at 550 for the four-year program. Admins can edit the cutoff.',
      },
    })
  }

  async function credits(studentId: string, category: string, rows: [string, number, number, number, string?][]) {
    for (const [name, credit, year, sem, domain] of rows) {
      await prisma.creditRecord.create({
        data: {
          studentId,
          courseNameZh: name,
          courseNameEn: name,
          categoryCode: category,
          credits: credit,
          grade: '86',
          termYear: year,
          termSemester: sem,
          domain: domain ?? null,
          passed: true,
        },
      })
    }
  }

  await credits(lin.id, 'MAJOR_REQUIRED', [
    ['微積分(1)', 3, 110, 1], ['微積分(2)', 3, 110, 2], ['計算機概論', 3, 110, 1], ['程式設計', 3, 110, 1],
    ['人工智慧程式設計', 3, 110, 2], ['人工智慧概論', 3, 110, 2], ['計算機網路工程', 3, 111, 1], ['人因工程概論', 3, 111, 1],
    ['機率與統計', 3, 111, 1], ['資料結構', 3, 111, 2], ['資料庫系統', 3, 111, 2], ['資料科學', 3, 112, 1],
    ['智慧裝置嵌入式系統實務', 3, 112, 1], ['智慧人機互動設計', 3, 112, 2], ['物聯網概論', 2, 112, 1],
    ['實務專題(1)', 2, 112, 1], ['實務專題(2)', 2, 112, 2], ['機器學習實務', 3, 112, 2], ['雲端物聯網開發', 3, 113, 1],
    ['國文(一)', 2, 110, 1], ['國文(二)', 2, 110, 2], ['英文(一)', 2, 110, 1], ['英文(二)', 2, 110, 2],
    ['英文(三)', 2, 111, 1], ['英文(四)', 2, 111, 2], ['溝通與表達', 2, 111, 1], ['科技與社會', 2, 111, 2],
    ['程式實作(一)', 2, 112, 1], ['程式實作(二)', 2, 112, 2], ['專業倫理', 2, 113, 1], ['生涯規劃', 2, 113, 1],
    ['實驗(一)', 2, 113, 1], ['實驗(二)', 2, 113, 2], ['專題先修', 2, 113, 2], ['綜合實作', 2, 113, 2], ['進階實作', 3, 113, 2],
  ])
  await credits(lin.id, 'ELECTIVE', [
    ['資訊安全', 3, 110, 2], ['工程數學', 3, 111, 1], ['線性代數', 3, 111, 2], ['訊號處理', 3, 111, 2],
    ['區塊鏈', 3, 112, 1], ['資料探勘', 3, 112, 2], ['網站後端開發', 3, 112, 2], ['電腦視覺', 3, 113, 1],
    ['自然語言處理', 3, 113, 1], ['使用者體驗設計', 3, 113, 2], ['創新與創業設計', 3, 113, 2],
  ])
  await credits(lin.id, 'CROSS_DEPT', [
    ['金融科技', 3, 112, 1], ['生物科技概論', 3, 112, 2], ['智慧農業', 3, 113, 1], ['精準行銷', 3, 113, 2], ['醫學護理資訊學', 4, 113, 2],
  ])
  await credits(lin.id, 'LIBERAL', [
    ['文學與思想', 2, 110, 1, '人文'], ['歷史與文化', 2, 110, 2, '社會'], ['自然科學概論', 2, 111, 1, '自然'], ['資訊與社會', 2, 111, 2, '科技'],
  ])
  await credits(wu.id, 'MAJOR_REQUIRED', [
    ['微積分(1)', 3, 110, 1], ['微積分(2)', 3, 110, 2], ['程式設計', 3, 110, 1], ['資料結構', 3, 111, 1],
    ['資料庫系統', 3, 111, 2], ['機器學習實務', 3, 112, 2], ['示範必修彙整', 56, 113, 1],
  ])
  await credits(wu.id, 'ELECTIVE', [['資訊安全', 3, 110, 2], ['工程數學', 3, 111, 1], ['示範選修彙整', 15, 112, 2]])
  await credits(wu.id, 'CROSS_DEPT', [['金融科技', 3, 112, 1], ['生物科技概論', 3, 112, 2], ['智慧農業', 2, 113, 1]])
  await credits(wu.id, 'LIBERAL', [['文學與思想', 2, 110, 1, '人文'], ['歷史與文化', 2, 110, 2, '社會']])
  await credits(chen.id, 'MAJOR_REQUIRED', [['微積分(1)', 3, 112, 1], ['程式設計', 3, 112, 1], ['資料結構', 3, 113, 1], ['機器學習實務', 3, 114, 2]])
  await credits(hsu.id, 'MAJOR_REQUIRED', [['微積分(1)', 3, 112, 1], ['程式設計', 3, 112, 2], ['資料庫系統', 3, 113, 2], ['實務專題(1)', 2, 114, 1]])
  await credits(huang.id, 'MAJOR_REQUIRED', [['微積分(1)', 3, 113, 1], ['程式設計', 3, 113, 2], ['人工智慧概論', 3, 114, 1]])
  await credits(chang.id, 'MAJOR_REQUIRED', [['微積分(1)', 3, 115, 1], ['程式設計', 3, 115, 1], ['計算機概論', 3, 115, 1]])

  const toeic = await prisma.recognizedItem.findFirst({ where: { nameEn: 'TOEIC Listening & Reading' } })
  const rule110 = await prisma.ruleSet.findUnique({ where: { cohortYear: 110 }, include: { thresholds: true } })
  const rule112 = await prisma.ruleSet.findUnique({ where: { cohortYear: 112 }, include: { thresholds: true } })
  const english110 = rule110!.thresholds.find((item) => item.code === 'ENGLISH')!
  const english112 = rule112!.thresholds.find((item) => item.code === 'ENGLISH')!

  async function evidence(name: string, lines: string[]) {
    const pngPath = path.join(__dirname, '../prisma/fixtures', `${name}.png`)
    const png = await fs.readFile(pngPath)
    const savedPng = await saveUpload(png)
    const savedPdf = await saveUpload(simplePdf(lines))
    if (!savedPng || !savedPdf) throw new Error('fixture')
    return { png: savedPng, pdf: savedPdf }
  }

  const linFiles = await evidence('toeic-780', ['NUTC AI demo evidence', 'TOEIC Listening and Reading', 'Lin Ke-Xin', 'Score 780', 'Meets group A cutoff 550'])
  await prisma.submission.create({
    data: {
      studentId: lin.id,
      thresholdId: english110.id,
      recognizedItemId: toeic!.id,
      scoreText: '780',
      status: 'APPROVED',
      reviewComment: '多益 780，達到 A 組 550。',
      reviewerId: admin.id,
      reviewedAt: new Date('2026-10-02'),
      files: {
        create: [
          { storageKey: linFiles.pdf.storageKey, originalName: 'toeic-780.pdf', mimeType: linFiles.pdf.mime, size: linFiles.pdf.size },
          { storageKey: linFiles.png.storageKey, originalName: 'toeic-780.png', mimeType: linFiles.png.mime, size: linFiles.png.size },
        ],
      },
    },
  })
  const wuFiles = await evidence('toeic-600', ['NUTC AI demo evidence', 'TOEIC Listening and Reading', 'Wu Cheng-En', 'Score 600', 'Pending review'])
  await prisma.submission.create({
    data: {
      studentId: wu.id,
      thresholdId: english110.id,
      recognizedItemId: toeic!.id,
      scoreText: '600',
      status: 'PENDING',
      note: '補考成績，請系辦確認。',
      files: { create: [{ storageKey: wuFiles.pdf.storageKey, originalName: 'toeic-600.pdf', mimeType: wuFiles.pdf.mime, size: wuFiles.pdf.size }] },
    },
  })
  const chenFiles = await evidence('toeic-400', ['NUTC AI demo evidence', 'TOEIC Listening and Reading', 'Chen Si-Yu', 'Score 400', 'Below 550'])
  await prisma.submission.create({
    data: {
      studentId: chen.id,
      thresholdId: english112.id,
      recognizedItemId: toeic!.id,
      scoreText: '400',
      status: 'REJECTED',
      reviewComment: '400 分低於 A 組 550，請再考或改修輔導課程。',
      reviewerId: admin.id,
      reviewedAt: new Date('2026-11-01'),
      files: { create: [{ storageKey: chenFiles.png.storageKey, originalName: 'toeic-400.png', mimeType: chenFiles.png.mime, size: chenFiles.png.size }] },
    },
  })

  await prisma.comment.create({
    data: { studentId: chen.id, authorId: teacherA.id, body: '大四上了，英文還差一截。下個月的多益記得報，考前可以把練習時數傳給我。' },
  })
  await prisma.notification.create({
    data: {
      userId: chen.id,
      kind: 'deadline:ENGLISH',
      titleZh: '英文能力門檻已過建議期限',
      titleEn: 'English threshold is past the suggested deadline',
      bodyZh: '建議在大二結束前通過。你目前是大四，這項仍未完成。',
      bodyEn: 'The suggested point was the end of year 2. You are in year 4 and it is still open.',
      emailTo: chen.email,
      emailStatus: 'logged',
    },
  })
  await prisma.notification.create({
    data: {
      userId: chang.id,
      kind: 'welcome',
      titleZh: '歡迎加入人工智慧應用工程學士學位學程',
      titleEn: 'Welcome to the AI Application Engineering program',
      bodyZh: '你可以從總覽看到 115 學年度的畢業規則，並依課程地圖安排四年修課。',
      bodyEn: 'Your overview shows the cohort 115 rules and the four-year map.',
      emailTo: chang.email,
      emailStatus: 'logged',
    },
  })

  await prisma.retentionPolicy.create({ data: { id: 1, retentionYears: 5 } })
  for (const [key, value] of Object.entries({ academicYear: '115', semester: '1', preauditMonth: '9', preauditDay: '1' })) {
    await prisma.appSetting.create({ data: { key, value } })
  }
  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: 'seed',
      entityType: 'system',
      summaryZh: '載入示範資料與已查核的畢業規則',
      summaryEn: 'Loaded demo data and the graduation rules that were verified',
    },
  })
  void env
}

function simplePdf(lines: string[]) {
  const escaped = lines.map((line) => line.replace(/[()\\]/g, ''))
  const commands = ['BT', '/F1 16 Tf', '72 760 Td']
  escaped.forEach((line, index) => {
    if (index) commands.push('0 -28 Td')
    commands.push(`(${line}) Tj`)
  })
  commands.push('ET')
  const stream = commands.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const start = Buffer.byteLength(body)
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  body += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
  return Buffer.from(body)
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
