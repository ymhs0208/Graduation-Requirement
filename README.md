# 畢業門檻追蹤

國立臺中科技大學人工智慧應用工程學士學位學程的畢業門檻上傳與進度系統。介面為繁體中文，可切換英文。

## 本地執行

需要 Node.js 22 與 PostgreSQL 16。

```bash
cp .env.example .env
# 把 DATABASE_URL 改成你的資料庫
cd server
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

另開一個終端機：

```bash
cd web
npm install
npm run dev
```

開啟 [http://127.0.0.1:43123](http://127.0.0.1:43123)。API 在 43124，由 Vite 轉送 `/api`。

管理員登入需要當時的 TOTP。在 `server` 目錄執行 `npm run totp` 可印出示範帳號的 6 位數。

## 示範帳號

| 角色 | 帳號 | 密碼 | 說明 |
| --- | --- | --- | --- |
| 系上管理員 | A0001 | Admin#Nutc2026 | 已啟用 TOTP，密鑰 `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` |
| 班導師 | T1001 | Teach#Nutc2026 | 智應延畢、智應四甲、智應三甲 |
| 班導師 | T1002 | Teach#Nutc2026 | 智應一甲 |
| 學生 | B11023008 林可芯 | Study#Nutc2026 | 110 年，學分與英文已齊，系訂門檻仍待公告 |
| 學生 | B11023015 吳承恩 | Study#Nutc2026 | 110 年延畢，學分不足、英檢審核中 |
| 學生 | B11223001 陳思妤 | Study#Nutc2026 | 大四，英檢未過 |
| 學生 | B11523001 張安然 | Study#Nutc2026 | 新生，會看到導覽 |
| 學生 | B11523099 簡以安 | Init#Nutc2026 | 首次登入必須改密碼 |
| 已停用 | B11023021 | Study#Nutc2026 | 畢業停用，無法登入 |

成績是示範用，不是官方開課學分。

## 已寫入的規則與出處

- 110 學年：總學分 130、必修 89、選修 33、跨系選修 16（選修內下限）、博雅 8 學分／4 領域。來源：[教務系統 110](https://aisap.nutc.edu.tw/public/day/std_dep_course.aspx?sch_type=4&dep=267&yy=110)
- 115 學年：總學分 130、必修 90、選修 32、跨系 16、博雅 8／4 領域。來源：[教務系統彙整](https://aisap.nutc.edu.tw/public/day/std_dep_course.aspx?_p=2)
- 學程課程標準頁（110–114 連結）：[ai.nutc.edu.tw](https://ai.nutc.edu.tw/p/412-1067-13324.php)
- 校級四年制最低 128 學分，本學程以課程標準 130 為準。[學則 PDF](https://ai.nutc.edu.tw/var/file/67/1067/img/3580/620887369.pdf)
- 英文 A 組：全民英檢中級複試、多益 550、TOEFL ITP 460、TOEFL iBT 42、IELTS 4、校內英檢 550。[辦法](https://language.nutc.edu.tw/var/file/79/1079/img/3036/125461901.pdf)、[對照表（114.09.16）](https://language.nutc.edu.tw/var/file/79/1079/img/3036/300875693.pdf)
- 課程地圖只有年級、沒有學分與上下學期：[課程地圖](https://ai.nutc.edu.tw/p/404-1067-76129.php?Lang=zh-tw)
- 校外實習是選修抵免，不是人人必過的非學分門檻。[實習要點](https://ai.nutc.edu.tw/var/file/67/1067/img/3445/391283174.pdf)
- 113 學年起日間部四技服務與學習 1 學分。[辦法](https://csc.nutc.edu.tw/var/file/28/1028/img/331488135.pdf)。是否含在 130 內，課程標準沒寫，系統分開追蹤。

## 占位、尚未當成正式數字

- 111、112、113、114 的學分欄：頁面連得到，抓取時逾時，必填學分是空的並標成待確認。
- 「日間部學生畢業資格審查作業要點」第七點：教務系統有點名，學程網站沒有全文。
- 證照與競賽清單是空的，要管理員新增後學生才能選。學院證照獎勵表不是畢業條件。
- 課程地圖上的課沒有官方學分，四年計畫不填學分。

管理員可在「畢業規則」直接改這些數字。

## 測試

```bash
cd server
npm test
```

包含學生不能看別人的檔案、非所屬班導不能看學生、班導不能核可或退回、只有管理員核可會更新進度。

## 部署

系上 Linux 主機見 [deploy/DEPLOY.zh-Hant-TW.md](deploy/DEPLOY.zh-Hant-TW.md)。

## 標誌

頁首與圖示使用學程官網標誌，出處寫在 `web/public/brand/SOURCE.md`。
