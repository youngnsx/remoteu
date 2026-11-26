# 臨時 WebRTC 螢幕分享與即時協作系統規格書 (Screen Share & Chat Spec)

本規格書定義一套基於 **WebRTC**、**Cloud Firestore** 與 **Firebase Hosting** 的無伺服器（Serverless）即時協作系統。系統提供免安裝、以房間代碼與密碼快速進入的點對點（P2P）螢幕分享與圖文聊天功能。

---

## 1. 系統架構與設計目標

### 1.1 設計原則
* **Zero-Backend 維護**：不架設與維運 Node.js/WebSocket 伺服器，利用 Firestore 充當 WebRTC 信令交換（Signaling）與訊息資料庫。
* **低延遲傳輸**：螢幕畫面透過 WebRTC 點對點（P2P）串流，不經過應用程式伺服器轉發。
* **即開即用**：純瀏覽器環境運作，使用者無須安裝任何外掛程式或客戶端軟體。

### 1.2 系統組件架構

| 角色 / 服務 | 職責 | 備註 |
| :--- | :--- | :--- |
| **Firebase Hosting** | 託管前端靜態資源（HTML/JS/CSS） | 強制啟用 HTTPS（滿足螢幕擷取 API 安全要求） |
| **Cloud Firestore** | 儲存房間資訊、聊天訊息，處理 WebRTC 信令交換 | 透過 `onSnapshot` 實現即時同步 |
| **Google STUN** | 負責 NAT 穿越與公網 IP/Port 探索 | 預設使用 `stun:stun.l.google.com:19302` |
| **Client Browser** | 螢幕擷取（Screen Capture API）、WebRTC 編解碼與介面渲染 | 支援 Chrome、Edge、Safari、Firefox |

---

## 2. 資料庫結構 (Firestore Schema)

```text
firestore/（具名資料庫 remoteu）
├── spaces/                               # 不允許 list，必須算得出 key 才能存取
│   └── {key}/                            # key = PBKDF2(password, "remoteu:" + roomId) 的 64 字元 hex
│       ├── createdAt: number             # 建立時間戳記 (毫秒)；不存密碼
│       ├── session: map                  # 房主發布的 session { id, offer: { type, sdp } }
│       ├── answer: map                   # 訪客回覆 { session, type, sdp }
│       ├── joinRequest: number           # 訪客加入時寫入的時間戳記，通知房主重新送 offer
│       ├── callerCandidates/             # 房主的 ICE candidate (子集合)
│       │   └── {candidateId}/
│       │       └── [RTCIceCandidateInit] + session: string
│       ├── calleeCandidates/             # 訪客的 ICE candidate (子集合)
│       │   └── {candidateId}/
│       │       └── [RTCIceCandidateInit] + session: string
│       └── messages/                     # 即時文字與圖片訊息 (子集合，只能新增)
│           └── {messageId}/
│               ├── type: "text" | "image"
│               ├── content: string       # 文字內容或 Base64 data URL
│               ├── sender: "caller" | "callee"
│               └── timestamp: number
└── rooms/                                # 舊版資料（含明文密碼），規則已全面禁止存取
```

---

## 3. 核心功能規格 (Functional Specifications)

### 3.1 房間驗證與角色分配
1. 房主在首頁設定密碼，系統產生隨機 `roomId`，該分頁在 sessionStorage 標記為房主。
2. 雙方都以 `PBKDF2(password, "remoteu:" + roomId)` 算出 `key`（見 `src/lib/roomKey.ts`），讀取 `spaces/{key}`：
   * **文件不存在**：
     * 房主分頁：建立 `spaces/{key}`（只含 `createdAt`），指派為 **Caller（房主/發起方）**。
     * 其他分頁：顯示「房間不存在或密碼錯誤」。密碼錯誤會算出不同的 key，因此兩者無法區分。
   * **文件已存在**：房主分頁仍為 Caller（並清除舊信令），其他分頁指派為 **Callee（訪客/接收方）**。
3. 密碼不會寫入資料庫；規則禁止 list `spaces`，只知道 `roomId` 的人無法讀取任何房間資料。

### 3.2 WebRTC 信令與連線流程 (Signaling Flow)

```text
Caller (房主)                     Firestore                     Callee (訪客)
      |                               |                              |
      |--- 1. 建立房間 / 設定密碼 --->|                              |
      |                               |<--- 2. 輸入密碼驗證進入 -----|
      |                               |                              |
      |--- 3. 觸發螢幕分享            |                              |
      |--- 4. 寫入 SDP Offer -------->|                              |
      |                               |--- 5. 監聽到 Offer --------->|
      |                               |<-- 6. 寫入 SDP Answer -------|
      |<-- 7. 監聽到 Answer ----------|                              |
      |                               |                              |
      |<== 8. 雙向交換 ICE Candidates (caller/calleeCandidates) ====>|
      |                                                              |
      |<================= 9. 建立 P2P 直連傳輸 ======================>|
      |----------------- 傳輸即時螢幕視訊串流 ---------------------->|
```

### 3.3 螢幕擷取規格
* **調用 API**：`navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`。
* **觸發限制**：必須由使用者主動點擊按鈕觸發，瀏覽器跳出選擇器後由使用者選取「全螢幕」、「視窗」或「分頁」。
* **生命週期管理**：監聽 `MediaStreamTrack.onended` 事件。當使用者點擊瀏覽器原生「停止共用」按鈕時，自動關閉本機視訊軌並通知清理狀態。

### 3.4 即時聊天規格
* **文字傳輸**：寫入 `messages` 子集合，雙方透過 `onSnapshot` 監聽並自動滾動至最新訊息。
* **圖片傳輸**：
  * **快速方案 (MVP)**：以 `FileReader` 將圖片轉為 Base64 字串存入 Firestore（限制單檔 < 700 KB：Base64 編碼後約膨脹為 4/3 倍，約 956 KB，才不會超過 Firestore 1 MiB 文件限制）。
  * **完整方案**：檔案上傳至 Firebase Storage，訊息內容僅儲存圖片的公開下載 URL。

---

## 4. Firestore 安全性規則 (Security Rules)

完整規則見專案根目錄的 [`firestore.rules`](../firestore.rules)，測試見 `tests/firestore.rules.test.mjs`（`npm run test:rules`）。重點：

* `spaces/{key}`：只允許 `get`，不允許 `list`；key 必須是 64 字元 hex。
* 建立房間時只能有 `createdAt`（不能存密碼）；更新只能動 `session`、`answer`、`joinRequest`，且不能改 `createdAt`；不能刪除。
* `callerCandidates` / `calleeCandidates`：可讀、可新增、可刪除；欄位限定為 RTCIceCandidateInit 加 `session`。
* `messages`：只能讀取與新增；`type`、`sender` 限定值，`content` 不超過 1,000,000 字元。
* 舊的 `rooms/{roomId}` 沒有任何 allow 規則，一律拒絕。

已知限制：知道 key 的人（即知道密碼的人）彼此權限相同，規則無法區分房主與訪客；若要區分需加上 Firebase Anonymous Auth。

---

## 5. 限制與邊界考量 (Constraints & Future Enhancements)

1. **網路穿透（NAT Traversal）**：
   * 預設採用 Google 公開 STUN 伺服器。若雙方任一端處於嚴格企業對稱型 NAT（Symmetric NAT）或受限防火牆環境，需補上 TURN 伺服器中繼（如 Coturn、Twilio TURN）。
2. **操作控制權限**：
   * 本架構為純 WebRTC 視訊投影，受瀏覽器沙盒限制，無法直接操控對方的滑鼠或鍵盤。
3. **拓撲規模**：
   * 專為 1 對 1（1:1）臨時遠端協作設計。如需擴展至 3 人以上多方螢幕會議，建議升級為 SFU 架構（如 LiveKit）。
