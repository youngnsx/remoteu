# Remote U 系統架構

## 技術棧 (Tech Stack)
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide React (Icons)
- **Signaling & Database**: Firebase Cloud Firestore
- **P2P Engine**: WebRTC (RTCPeerConnection, getDisplayMedia)
- **Deployment**: Docker (Nginx Alpine)

## 系統架構圖
(參考 SPEC.md 內容)
採用無伺服器 (Serverless) 架構，前端透過 Firestore 交換 SDP Offer/Answer 與 ICE Candidates，隨後建立 WebRTC P2P 連線進行螢幕分享與文字聊天。

## 資料流 (Signaling Flow)
1. 房主建立房間，設定密碼。
2. 訪客輸入密碼進房，寫入 `joinRequest` 通知房主。
3. 房主開始分享或收到新的 `joinRequest` 時，重建 PeerConnection 並寫入 `session = { id, offer }`。
4. 訪客看到新的 session id → 重建 PeerConnection，寫入 `answer = { session, type, sdp }`。
5. ICE Candidates 寫入 `callerCandidates` / `calleeCandidates`，每筆帶 `session`，雙方只接收同 session 的 candidate。
6. 房主停止分享時刪除 `session` / `answer`，訪客關閉連線。
