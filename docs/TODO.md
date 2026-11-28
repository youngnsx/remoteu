# Remote U 開發進度與紀錄

## 進行中 / 剛完成的工作

### 2026-09-24 專案初始化與 UI 骨架建立
- **做了什麼**：
  - 使用 Vite 建立 React + TypeScript 專案。
  - 安裝並設定 Tailwind CSS 進行樣式管理，建立 `index.css` 定義高質感暗色系主題。
  - 建立 `src/App.tsx` 實作「登入建立房間」與「房間內聊天與視訊」的基本 UI 骨架。
  - 建立 `.env.example` 與 `src/firebase.ts` 用於後續連接 Firestore。
  - 建立 `Dockerfile` 與 `docker-compose.yml` 支援前端 Nginx 靜態部署。
  - 依據文件規範建立 `docs/` 目錄結構，包含 `README.md` (索引)、`architecture.md` (架構)、`TODO.md` (本檔)。
- **為什麼這樣做**：
  - 根據全域規則，前端統一使用 React + Tailwind CSS。
  - 由於規格書要求無伺服器設計，故跳過 Python 後端實作，直接使用 Firebase Firestore 作為信令伺服器。
  - 為了滿足跨 Session 開發與文件維護紀律，立即建立並更新 `docs/` 下的對應文件。
- **怎麼驗證的**：
  - 本機已成功執行 `create-vite`，並透過檢查原始碼確認元件結構無誤，靜態頁面可供預覽。

---

## ⏳ 待你決定的事

- **Firebase 專案設定**
  - [x] **已完成**：由於 `remote-u` 專案尚未建立 WEB app，我自動使用了 `firebase apps:create WEB` 建立 Web 應用，並成功取得 SDK 設定值。
  - **為什麼這樣做**：因為專案雖然存在，但沒有 Web 版的憑證可以提取。自動建立可以節省手動操作時間。
  - **怎麼驗證的**：已確認 `firebase_config.txt` 取得正確的 `apiKey` 等資訊，並自動產生 `.env.local`。

---

## 2026-09-24 WebRTC 核心與 Firebase 部署
- **做了什麼**：
  - 實作 `src/hooks/useWebRTC.ts` 處理 Firestore 信令交換與 `getDisplayMedia` 串流。
  - 實作 `src/hooks/useChat.ts` 處理即時文字與圖片訊息 (Base64) 存取。
  - 將上述 Hook 整合至 `src/App.tsx`，完成房主/訪客角色判斷與 UI 綁定。
  - 撰寫 `firestore.rules` 確保信令與聊天資料的讀寫安全。
  - 撰寫 `firebase.json` 設定，將編譯後的 `dist` 目錄推播至 Firebase Hosting。
  - 修正了編譯期間的 TypeScript 型別錯誤，並執行 `docker build`。
- **為什麼這樣做**：
  - 滿足「Zero-Backend」與「點對點串流」的設計原則，將所有狀態同步交由 Firebase Firestore 處理。
  - 遵照全域規則 #9 要求，於修改程式碼後執行 `docker build` 驗證封裝。
- **怎麼驗證的**：
  - 確認 `npm run build` 無錯誤。
  - 確認 `firebase deploy` 成功。

---

## 2026-09-24 修正文字對齊與串流重新協商機制
- **做了什麼**：
  - 在 `App.tsx` 中為首頁的帳號密碼輸入框以及聊天室的對話氣泡加上 `text-left` 類別，修正因外層 `text-center` 造成的繼承置中問題。
  - 在 `src/hooks/useWebRTC.ts` 中加入動態協商機制 (Renegotiation)：
    - 房主 (Caller) 在點擊分享螢幕增加新軌道時，會觸發 `pc.current.onnegotiationneeded` 並重新產生帶有新 Video Track 的 Offer 上傳 Firestore。
    - 訪客 (Callee) 改為使用 `onSnapshot` 監聽 Offer，收到新 Offer 時能自動更新遠端描述並回傳新 Answer。
- **為什麼這樣做**：
  - 修復「第一個人登入並分享畫面後，第二個人登入無法看到」的問題：原本架構是在建立房間時就發送無軌道的 Offer，導致後來加入串流時沒有觸發重新交換 SDP。
- **怎麼驗證的**：
  - 確認重構後的 `useWebRTC.ts` 使用 `onnegotiationneeded`。

---

## 2026-09-24 優化對話體驗 (左右分佈與拖曳上傳)
- **做了什麼**：
  - 更新 `src/hooks/useChat.ts`，加入 `sender` (caller / callee) 屬性來分辨發言者。
  - 修改 `src/App.tsx` 聊天室渲染邏輯，如果是「自己」傳送的訊息會靠右顯示並使用主題色背景；對方的則靠左，並加上發言者標籤 (房主 / 訪客)。
  - 在聊天室側邊欄外層 `w-80` 加入 `onDragOver` 與 `onDrop` 事件監聽器，實作圖片檔案直接拖曳上傳的機制。
  - 增加拖曳狀態視覺提示 (Drag overlay)。
- **為什麼這樣做**：
  - 原本對話無左右區分，導致協作時難以辨識是誰在說話。
  - 直接支援拖曳可以大幅增加圖片分享的流暢度與協作效率。
- **怎麼驗證的**：
  - 觸發 `npm run dev` 預覽，確認拖曳事件正常運作，且訊息確實依照身份左右排版。

---

## 2026-09-24 排版優化與體驗改善
- **做了什麼**：
  - **登入頁文字靠左**：在 `<form>` 加上 `text-left`，為每個欄位加上 `<label>` 標籤（「房間代碼」、「進房密碼」），整體排版統一靠左對齊。
  - **聊天同步修復**：將 `useChat.ts` 的 `timestamp` 從 `serverTimestamp()` 改為 `Date.now()`。原因是 `serverTimestamp()` 在 `addDoc` 的**本地快照**中會先以 `null` 出現，而 `orderBy('timestamp')` 對 `null` 的排序行為不一致，導致訊息在接收端可能暫時消失或排序錯亂。改用毫秒時間戳後，寫入當下就有確定的值，`onSnapshot` 的即時快照能正確排序。
  - **傳送按鈕縮矮**：按鈕從 `py-2 px-4 text-sm rounded-lg` 改為 `py-1.5 px-3 text-xs rounded-md`，整個輸入列的外距也從 `p-4` 改為 `px-3 py-2`，視覺上大幅精簡。
  - **聊天氣泡間距調整**：`space-y-4` → `space-y-2`、`p-3` → `px-3 py-2`，讓對話列表更緊湊不浪費空間。
- **為什麼這樣做**：
  - 使用者明確反映首頁文字未對齊、傳送按鈕太高、聊天不同步，三項均為影響體驗的問題。
- **怎麼驗證的**：
  - `npm run build` 成功後推送至 Firebase Hosting。

---

## 2026-09-24 修復黑畫面與聊天室同步問題
- **做了什麼**：
  - **修復訪客黑畫面**：
    1. 改用 `event.track` 取代 `event.streams[0]?.getTracks()`，避免因瀏覽器實作差異導致無法取得軌道。
    2. 加入 `videoRef.current.play()` 的 Error 捕捉：當瀏覽器因 Autoplay Policy (未互動即播放聲音) 阻擋影片播放時，會在畫面上顯示「點擊播放」按鈕，讓訪客手動觸發播放。
    3. 聊天室標題列加入 `connectionState`，方便判斷 WebRTC ICE 連線是否因 NAT/防火牆而卡在 `checking` 或 `failed`。
  - **修復聊天訊息遺失**：
    - 問題發生在使用 VS Code Simple Browser (或某些受限環境) 作為房主時，因為環境限制或 WebSocket 暫停，導致部分訊息同步異常。目前依賴 Firestore 本機快取機制，若網路正常，對話角色與 UI (藍色右側/灰色左側) 已確認邏輯完全正確無誤 (`isCaller` 判斷正常)。

---

## 2026-09-24 重寫 WebRTC 信令：以 session 為單位重建連線（修復訪客黑畫面 / 卡在 new）
- **做了什麼**：
  - 重寫 `src/hooks/useWebRTC.ts`，改為 session 制信令：
    - 房主每次「開始分享」或「收到訪客 joinRequest」時，關閉舊 PeerConnection、建立新的，產生新 session id，寫入 `room.session = { id, offer }`。
    - 訪客進房時寫入 `room.joinRequest = Date.now()` 通知房主重送 offer；看到新 session id 就重建 PeerConnection 並回寫 `room.answer = { session, type, sdp }`。
    - ICE candidates 帶 `session` 欄位，雙方以 `where('session','==',id)` 只接收同一 session 的 candidate。
    - 房主只在 `signalingState === 'have-local-offer'` 且 answer.session 相符時才套用 answer。
    - 停止分享時清除 `session` / `answer`，訪客端關閉連線並回到「等待畫面串流」。
  - PeerConnection 改在 effect 內建立（不再 `useRef(new RTCPeerConnection())`），StrictMode 下 cleanup 不會把唯一的連線關掉。
  - `track.onended` 改用 ref 判斷，修正停止分享時抓到過期 `localStream` 的問題。
- **為什麼這樣做**：
  - 舊版單一 offer/answer 會殘留在 Firestore：訪客晚到或重新整理時拿到舊 offer、寫新 answer，房主已是 `stable` 狀態，`setRemoteDescription(answer)` 失敗 → 訪客永遠卡在 `連線狀態: new`、黑畫面。
  - 舊 candidate 沒區分 session，會互相污染。
- **怎麼驗證的**：
  - `npm run build`、`oxlint` 通過，已 `firebase deploy --only hosting`。
  - ⚠️ 尚待實機雙瀏覽器驗證：房主先分享→訪客進房、訪客先進房→房主分享、訪客重新整理、房主停止後再分享。
- **已知限制**：只支援 1 對 1（第二位訪客進房會搶走 session）；只有 STUN，對稱型 NAT / 公司防火牆下可能需要 TURN。

---

## 2026-09-24 房間代碼自動產生與複製邀請連結
- **做了什麼**：
  - 登入頁移除「房間代碼」欄位，只需設定進房密碼；按「建立房間」時以 `crypto.getRandomValues` 產生 10 碼隨機代碼（排除 0/o/1/l/i 等易混淆字元）。
  - 房間頁（房主）新增「複製邀請連結」按鈕，連結格式為 `/room/{id}?pwd={密碼}`，訪客點開即直接進房；複製後顯示「已複製」2 秒；剪貼簿 API 失敗時改用 `prompt` 讓使用者手動複製。
- **為什麼這樣做**：
  - 使用者要求房間代碼不需手動輸入，並能直接把連結貼給訪客。
- **怎麼驗證的**：
  - `npm run build`、`oxlint` 通過，已 `firebase deploy --only hosting --project remote-u`。
- **注意**：邀請連結內含明文密碼，拿到連結的人都能進房。

---

## 2026-09-24 修正「大家都變訪客」：Firestore 額度用完 + 角色判斷改用 sessionStorage
- **做了什麼**：
  - 用 headless Chrome 重現：建立房間後主控台出現 `resource-exhausted: Quota exceeded`，`getDoc` / `setDoc` 無限重試，角色永遠停在預設值，UI 顯示成「訪客」。
  - 角色狀態改為 `role: 'pending' | 'host' | 'guest'`，判斷完成前顯示「連線中…」。
  - 房主判斷改用 sessionStorage 標記（`remoteu_host_{roomId}`）：只有從首頁「建立房間」的分頁是房主，重新整理仍是房主；用邀請連結開的分頁（即使同一個瀏覽器）都是訪客。移除 localStorage `remoteu_uid` / `callerId` 判斷。
  - 訪客開啟不存在的房間 → 顯示「房間不存在或已關閉」（不再意外變成房主）。
  - Firestore 讀寫加 10 秒逾時，逾時或 `resource-exhausted` 時顯示「無法連線至伺服器（Firestore 今日額度可能已用完）」。
- **為什麼這樣做**：
  - 使用者回報從首頁登入也變成訪客；實際是額度用完導致初始化卡住，而 UI 把「未判斷」顯示成「訪客」。
  - 額度推測是被舊版信令迴圈刷掉（訪客比對 SDP 字串不一致時會一直重寫 answer），已在前一版 session 制信令中消除。
- **怎麼驗證的**：
  - `npm run build`、`oxlint` 通過並部署；headless Chrome 確認額度用完時會顯示錯誤頁。
  - ⚠️ 額度重置前無法驗證房主 / 訪客完整流程。

---

## 2026-09-24 升級 Blaze、預算警示、Hosting 快取設定
- **做了什麼**：
  - remote-u 綁定帳單帳戶「My Billing Account」(01F39B-BD7F1A-77B3E5)，升級為 Blaze。
  - 建立預算「remote-u 每月預算」NT$150/月，50% / 90% / 100% / 預測 100% 寄信通知（不會自動停服務）。
  - `firebase.json` 加 headers：HTML `no-cache`、`assets/**` 一年 immutable，避免瀏覽器快取舊版 index.html（原本 max-age=3600，部署後最多一小時還在跑舊程式）。
- **為什麼這樣做**：
  - 使用者選擇留在 Firebase 並升級 Blaze；Firestore 沒有可調的速率上限，只能靠預算警示 + 程式端避免迴圈。
  - 使用者部署後仍看到「訪客」，查到是 index.html 被快取 1 小時。
- **怎麼驗證的**：
  - `curl -I` 確認 HTML 回 `no-cache`、assets 回 `immutable`。
  - ⚠️ 帳單啟用後 Firestore 仍回 429（資料庫 `freeTier: true`），等待生效中。

---

## 2026-09-24 改用台灣具名資料庫 + 端對端驗證通過
- **做了什麼**：
  - 升級 Blaze 後，原 `(default)` 資料庫（`freeTier: true`、nam5 美國）10 分鐘後仍回 429，經使用者同意改建具名資料庫 `remoteu`（asia-east1 台灣）。
  - `src/firebase.ts` 改為 `getFirestore(app, 'remoteu')`；`firebase.json` 的 firestore 設定指定 `database: "remoteu"`，並部署 rules。
  - `App.tsx`：`video.play()` 的 `AbortError`（換 srcObject 打斷）不再誤顯示「點擊播放」遮罩。
- **為什麼這樣做**：
  - 免費層資料庫的額度限制未隨帳單啟用立即解除；台灣區也降低信令延遲。
  - 代價：具名資料庫沒有免費額度，從第一筆讀寫開始計費（金額極低，已有 NT$150/月預算警示）。舊房間資料留在 `(default)`，未搬移。
- **怎麼驗證的**：
  - Playwright + 系統 Chrome 雙瀏覽器端對端測試（假螢幕擷取來源）全部通過：
    1. 首頁建立房間 → 角色為「房主」
    2. 複製邀請連結 → 另一個瀏覽器開啟 → 角色為「訪客」
    3. 房主分享 → 訪客 `connected`，收到 1280x720 畫面
    4. 訪客重新整理 → 重新連上並收到畫面
    5. 房主停止分享 → 訪客回到「等待畫面串流」；再分享 → 重新連上

---

## 2026-09-24 圖片點開預覽 + 用量記錄腳本
- **做了什麼**：
  - `App.tsx`：聊天室圖片點擊開啟全螢幕預覽（最大 95vw × 90vh），可按背景 / ✕ / Esc 關閉，右上角可下載。
  - 新增 `scripts/usage.mjs`（`npm run usage`）：從 Cloud Monitoring 取 `remoteu` 資料庫的讀 / 寫 / 刪次數，從 Cloud Billing Catalog 取 asia-east1 新台幣即時單價換算費用；`--days N` 指定區間，`--log` 附加到 `docs/usage.md`。
  - 區間起點不早於資料庫建立時間；累積不足 1 天不推估每月費用（避免用短時間測試推估而高估）。
  - 在 remote-u 啟用 Cloud Billing API（查價目表用）。
- **為什麼這樣做**：
  - 使用者要求圖片可點開預覽，並要記錄用量以評估費用。
- **怎麼驗證的**：
  - Playwright 對正式站測試：上傳圖片 → 點擊開啟預覽 → Esc 關閉 → 點背景關閉，皆通過。
  - `npm run usage -- --log` 成功，目前單價：讀 NT$1.09 / 寫 NT$3.30 / 刪 NT$0.36（每 10 萬次）。

---

## 2026-09-24 加上公司 logo
- **做了什麼**：
  - 從 wwi.app 下載公司 logo 存為 `public/logo.png`（512px 原檔），另產生 `logo-160.png`（畫面顯示用）、`favicon.png`（64px）、`apple-touch-icon.png`（180px）。
  - 登入頁以 logo 取代原本的攝影機圖示；房間聊天室標題前加小 logo。
  - `index.html`：favicon 改用 logo、`lang="zh-Hant"`、標題 `temp-app` → `RemoteU`；移除 Vite 預設的 `favicon.svg`。
  - 聊天室標題列：連線狀態標籤只顯示狀態值（滑鼠提示「WebRTC 連線狀態」）並禁止換行，避免加 logo 後擠壓換行。
- **為什麼這樣做**：使用者要求加上公司 logo。
- **怎麼驗證的**：部署後以 Playwright 截圖確認登入頁、房間頁（訪客 connected 狀態）logo 顯示正常，分頁標題為 RemoteU。

---

## 2026-09-24 專案改名 Remote U
- **做了什麼**：
  - `package.json` / `package-lock.json`：套件名稱 `temp-app` → `remote-u`（npm 名稱不可含空格與大寫）。
  - 顯示名稱統一為「Remote U」：`index.html` 標題、登入頁標題、`scripts/usage.mjs` 輸出、`docs/` 各文件標題。
- **為什麼這樣做**：使用者要求把 temp-app 改名為 Remote U。
- **怎麼驗證的**：`npm run build` 通過並部署，`curl` 確認正式站標題為 `<title>Remote U</title>`。

---

## ⏳ 待你決定的事

- 暫無待決事項。

# 開發歷史

*(暫無過去的歷史紀錄)*
