# 揚才薪資系統

## 本地開發

```bash
npm install
npm run dev
```

## 部署到 Vercel

### 方法一：GitHub + Vercel（推薦）

1. 在 GitHub 建立新 repository（例如 `salary-app`）
2. 上傳這個資料夾的所有檔案
3. 到 vercel.com 點 "Import Git Repository"
4. 選擇剛建立的 repository → Deploy
5. 完成！取得網址如 `https://salary-app-xxx.vercel.app`

### 方法二：Vercel CLI（不需要 GitHub）

```bash
npm install -g vercel
npm run build
vercel --prod
```

## 部署到群暉 NAS

```bash
npm install
npm run build
# 把 dist/ 資料夾複製到 NAS 的 /volume1/web/salary/
```
