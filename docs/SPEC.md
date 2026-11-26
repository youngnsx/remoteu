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
firestore/
├── rooms/
│   └── {roomId}/
│       ├── password: string              # 房間進房密碼
│       ├── createdAt: number             # 建立時間戳記 (毫秒)
│       ├── offer: map                    # Caller 發布的 SDP Offer
│       │   ├── type: "offer"
│       │   └── sdp: string
│       ├── answer: map                   # Callee 發布的 SDP Answer
│       │   ├── type: "answer"
│       │   └── sdp: string
│       ├── callerCandidates/             # Caller 收集的 ICE 候選路徑 (子集合)
│       │   └── {candidateId}/
│       │       └── [RTCIceCandidateInit]
│       ├── calleeCandidates/             # Callee 收集的 ICE 候選路徑 (子集合)
│       │   └── {candidateId}/
│       │       └── [RTCIceCandidateInit]
│       └── messages/                     # 即時文字與圖片訊息 (子集合)
│           └── {messageId}/
│               ├── type: "text" | "image"
│               ├── content: string       # 文字內容或 Base64 / Storage URL
│               └── timestamp: number
```

---

## 3. 核心功能規格 (Functional Specifications)

### 3.1 房間驗證與角色分配
1. 使用者輸入 `roomId` 與 `password`。
2. 查詢 `rooms/{roomId}` 文件：
   * **房間不存在**：
     * 建立該房間文件並儲存密碼。
     * 當前使用者指派為 **Caller（房主/發起方）**。
   * **房間已存在**：
     * 比對輸入的密碼。
     * 若密碼相符，當前使用者指派為 **Callee（訪客/接收方）**。
     * 若密碼不符，阻擋進入並顯示錯誤警告。

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
  * **快速方案 (MVP)**：以 `FileReader` 將圖片轉為 Base64 字串存入 Firestore（限制單檔 < 800 KB 以避免達到 Firestore 1 MB 文件限制）。
  * **完整方案**：檔案上傳至 Firebase Storage，訊息內容僅儲存圖片的公開下載 URL。

---

## 4. Firestore 安全性規則 (Security Rules)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 房間主文件
    match /rooms/{roomId} {
      allow read: if true;
      allow create: if true;
      // 僅允許密碼相符時更新信令 (offer / answer)
      allow update: if request.resource.data.password == resource.data.password;

      // WebRTC ICE Candidates 交換子集合
      match /callerCandidates/{candidateId} {
        allow read, write: if true;
      }
      match /calleeCandidates/{candidateId} {
        allow read, write: if true;
      }

      // 聊天室訊息子集合
      match /messages/{messageId} {
        allow read: if true;
        allow create: if request.resource.data.type in ['text', 'image']
                      && request.resource.data.content is string;
      }
    }
  }
}
```

---

## 5. 限制與邊界考量 (Constraints & Future Enhancements)

1. **網路穿透（NAT Traversal）**：
   * 預設採用 Google 公開 STUN 伺服器。若雙方任一端處於嚴格企業對稱型 NAT（Symmetric NAT）或受限防火牆環境，需補上 TURN 伺服器中繼（如 Coturn、Twilio TURN）。
2. **操作控制權限**：
   * 本架構為純 WebRTC 視訊投影，受瀏覽器沙盒限制，無法直接操控對方的滑鼠或鍵盤。
3. **拓撲規模**：
   * 專為 1 對 1（1:1）臨時遠端協作設計。如需擴展至 3 人以上多方螢幕會議，建議升級為 SFU 架構（如 LiveKit）。
