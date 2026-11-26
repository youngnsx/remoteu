# Remote U

臨時 WebRTC 螢幕分享與即時協作系統。房主設定密碼建立房間，把連結分享給訪客，就能 1 對 1 分享螢幕並用文字或圖片聊天。

- **純前端**：React 19 + TypeScript + Vite + Tailwind CSS，沒有自架後端
- **信令**：Firebase Cloud Firestore（具名資料庫 `remoteu`，asia-east1）交換 SDP Offer/Answer 與 ICE Candidate
- **影像**：WebRTC P2P（`getDisplayMedia`），只使用 STUN，沒有 TURN
- **聊天**：訊息存在 `rooms/{roomId}/messages`，圖片以 Base64 存入（單檔上限 700KB）

## 快速開始

需要 Node.js 與一個已啟用 Firestore 的 Firebase 專案。

```bash
npm ci
cp .env.example .env.local   # 填入 Firebase Web App 設定
npm run dev
```

`.env.local` 需要的變數：

| 變數 | 說明 |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Web App 設定 |
| `VITE_FIREBASE_AUTH_DOMAIN` | 同上 |
| `VITE_FIREBASE_PROJECT_ID` | 同上 |
| `VITE_FIREBASE_STORAGE_BUCKET` | 同上 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | 同上 |
| `VITE_FIREBASE_APP_ID` | 同上 |

## 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 啟動開發伺服器 |
| `npm run build` | 型別檢查並建置到 `dist/` |
| `npm run lint` | 以 oxlint 檢查程式碼 |
| `npm run preview` | 預覽建置結果 |
| `npm run usage` | 估算 Firestore 用量與費用（加 `-- --log` 寫入 `docs/usage.md`） |

## 部署

- **Firebase Hosting**：`npm run build` 後執行 `firebase deploy`，會同時部署 `dist/` 與 `firestore.rules`（見 `firebase.json`）。
- **Docker**：`docker compose up -d --build`，以 Nginx 提供靜態檔。

## 專案結構

```
src/
  App.tsx              UI 與路由（建立房間、房間頁）
  firebase.ts          Firebase 初始化（具名資料庫 remoteu）
  hooks/useWebRTC.ts   以 session 為單位的 WebRTC 信令
  hooks/useChat.ts     聊天訊息與圖片傳送
firestore.rules        Firestore 安全規則
scripts/usage.mjs      Firestore 用量估算
docs/                  規格、架構、待辦與用量紀錄
```

## 文件

- [docs/SPEC.md](docs/SPEC.md)：功能規格與 Firestore 資料結構
- [docs/architecture.md](docs/architecture.md)：系統架構與信令流程
- [docs/TODO.md](docs/TODO.md)：進度與開發決策紀錄
- [docs/usage.md](docs/usage.md)：用量紀錄
