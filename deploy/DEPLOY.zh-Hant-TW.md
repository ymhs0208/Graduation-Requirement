# 系上主機部署

這套系統用 Docker Compose 跑在系上的 Linux 主機：網頁、API、PostgreSQL。上傳檔與資料庫都在這台機器的磁碟，不經過外部物件儲存。

## 1. 準備

安裝 Docker Engine 與 Compose 外掛。把這個目錄放到主機，例如 `/opt/gradtrack`。

```bash
cp .env.example .env
```

至少修改：

- `POSTGRES_PASSWORD`：資料庫密碼
- `APP_ORIGIN`：同學瀏覽器開的網址，例如 `https://grad.ai.nutc.edu.tw`
- `COOKIE_SECURE=true`
- `DEMO_SEED`：第一次試用可設 `true`，正式使用請保持 `false`，再由管理員匯入學生
- `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM`：學校郵件主機。留空時信件只寫入系統紀錄，畫面通知仍會出現
- `CAMPUS_CIDR`：要限制校園網段時填 `140.128.0.0/16` 這類 CIDR；填 `all` 則不限制

不要把 `.env` 提交到 git。

## 2. 啟動

```bash
docker compose up -d --build
```

第一次若 `certs/` 沒有憑證，容器會做一張 30 天的自簽憑證，瀏覽器會警告。請換成下面其中一種：

- Let's Encrypt：用 certbot webroot `/var/www/certbot`，把 `fullchain.pem` 與 `privkey.pem` 放到 `./certs/`，然後 `docker compose restart web`
- 學校憑證：同樣把兩個 pem 放到 `./certs/`

HTTPS 埠是 443，HTTP 會轉到 HTTPS。

示範資料：

```bash
docker compose exec api npx tsx prisma/seed.ts
```

## 3. 備份

```bash
sh scripts/backup.sh
```

會在 `backups/` 產生一個壓縮檔，裡面是 `pg_dump` 與上傳目錄。

還原：

```bash
sh scripts/restore.sh backups/檔名.tgz
docker compose restart api
```

建議每天排程執行備份，並把壓縮檔拷到另一台磁碟。

## 4. 更新

```bash
git pull
docker compose up -d --build
```

API 啟動時會執行 `prisma migrate deploy`。上傳磁碟與資料庫 volume 會保留。

## 5. 個資

停用帳號（休學、轉學、畢業）不能登入，紀錄仍可查。保存年限預設 5 年，可在「保存期限」修改。到期後「執行去識別」會清掉姓名、信箱與上傳檔，並寫入稽核。這是依個資法最小化保存的操作流程，正式保存年限請系辦再確認。

## 6. 之後接學校 SSO

現在用學號與教職員編號登入。認證程式把本地帳號與驗證碼分開，之後可以加 OIDC（例如學校 Google Workspace）而不改權限檢查。
