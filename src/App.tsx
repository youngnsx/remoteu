import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Video, KeyRound, ArrowRight, Image as ImageIcon, Link as LinkIcon, Check, X, Download } from 'lucide-react';
import { useWebRTC, markAsHost } from './hooks/useWebRTC';
import { useChat, MAX_IMAGE_BYTES, MAX_IMAGE_KB } from './hooks/useChat';

// 產生隨機房間代碼（排除易混淆字元 0/o/1/l/i）
function generateRoomId(length = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function JoinRoom() {
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password) {
      const roomId = generateRoomId();
      markAsHost(roomId);
      navigate(`/room/${roomId}?pwd=${encodeURIComponent(password)}`);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg-dark">
      <div className="w-full max-w-md p-8 space-y-8 bg-panel-dark rounded-xl shadow-2xl border border-border-dark">
        <div className="text-center">
          <img src="/logo-160.png" alt="WWI" className="mx-auto w-20 h-20 mb-4" />
          <h2 className="text-3xl font-bold text-text-primary tracking-tight">Remote U</h2>
          <p className="mt-2 text-sm text-text-secondary">
            臨時 WebRTC 螢幕分享與即時協作系統
          </p>
        </div>

        <form className="mt-8 space-y-6 text-left" onSubmit={handleJoin}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">設定進房密碼</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound className="h-4 w-4 text-text-secondary" />
                </div>
                <input
                  type="password"
                  required
                  className="appearance-none rounded-lg block w-full pl-9 pr-3 py-2.5 border border-border-dark bg-bg-dark text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
                  placeholder="輸入密碼"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="group w-full flex justify-center items-center py-2.5 px-4 text-sm font-medium rounded-lg text-white bg-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary focus:ring-offset-bg-dark transition-all duration-200"
          >
            建立房間
            <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </form>
      </div>
    </div>
  );
}

function Room() {
  const { id: roomId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const password = searchParams.get('pwd') || '';
  const navigate = useNavigate();

  const { localStream, remoteStream, error, role, isCaller, connectionState, startScreenShare, stopScreenShare } = useWebRTC(roomId!, password);
  const { messages, sendMessage, sendImage } = useChat(roomId!, isCaller);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [msgInput, setMsgInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_IMAGE_BYTES) {
      alert(`圖片大小不能超過 ${MAX_IMAGE_KB}KB`);
      return;
    }
    try {
      await sendImage(file);
    } catch (err) {
      console.error('傳送圖片失敗', err);
      alert(`傳送圖片失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const [showPlayBtn, setShowPlayBtn] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 按 Esc 關閉圖片預覽
  useEffect(() => {
    if (!previewImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewImage(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewImage]);

  // 複製邀請連結（含密碼，訪客點開即可直接進房）
  const copyInviteLink = async () => {
    const link = `${window.location.origin}/room/${roomId}?pwd=${encodeURIComponent(password)}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt('請手動複製以下連結：', link);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Bind stream to video element
  useEffect(() => {
    if (videoRef.current) {
      const activeStream = localStream || remoteStream;
      videoRef.current.srcObject = activeStream;
      if (activeStream) {
        videoRef.current.play().then(() => {
          setShowPlayBtn(false);
        }).catch(err => {
          // AbortError 是換 srcObject 打斷上一次 play()，不是被自動播放政策擋住
          if (err?.name === 'AbortError') return;
          console.warn('Autoplay blocked:', err);
          setShowPlayBtn(true);
        });
      }
    }
  }, [localStream, remoteStream]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg-dark text-white">
        <h2 className="text-2xl text-danger mb-4">連線錯誤</h2>
        <p>{error}</p>
        <button onClick={() => navigate('/')} className="mt-6 px-4 py-2 bg-panel-dark rounded-lg hover:bg-border-dark">回首頁</button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-bg-dark text-text-primary">
      <div className="flex-1 flex flex-col items-center justify-center border-r border-border-dark p-4">
        <div className="w-full h-full max-h-[80vh] bg-black rounded-lg overflow-hidden flex items-center justify-center shadow-lg border border-border-dark relative">
          <video 
            ref={videoRef}
            className="w-full h-full object-contain" 
            autoPlay 
            playsInline 
            controls={false} 
          />
          {!localStream && !remoteStream && (
            <div className="absolute text-text-secondary flex flex-col items-center gap-2">
              <Video className="w-12 h-12 opacity-50" />
              <p>等待畫面串流...</p>
            </div>
          )}
          {showPlayBtn && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <button 
                onClick={() => {
                  videoRef.current?.play();
                  setShowPlayBtn(false);
                }}
                className="px-6 py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold shadow-lg flex items-center gap-2 transition-transform hover:scale-105"
              >
                點擊播放 (需允許音訊)
              </button>
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-4">
          {isCaller && !localStream && (
            <button 
              onClick={startScreenShare}
              className="px-6 py-2 bg-primary hover:bg-primary-hover rounded-lg font-medium transition-colors"
            >
              分享螢幕
            </button>
          )}
          {isCaller && localStream && (
            <button 
              onClick={stopScreenShare}
              className="px-6 py-2 bg-danger hover:bg-danger-hover rounded-lg font-medium transition-colors"
            >
              停止分享
            </button>
          )}
          {isCaller && (
            <button
              onClick={copyInviteLink}
              className="px-6 py-2 bg-panel-dark border border-border-dark hover:bg-border-dark rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <LinkIcon className="w-4 h-4" />}
              {copied ? '已複製' : '複製邀請連結'}
            </button>
          )}
          <button 
            onClick={() => navigate('/')}
            className="px-6 py-2 bg-panel-dark border border-border-dark hover:bg-border-dark rounded-lg font-medium transition-colors"
          >
            離開房間
          </button>
        </div>
      </div>
      
      {/* 聊天室 */}
      <div 
        className={`w-80 bg-panel-dark flex flex-col relative ${isDragging ? 'ring-2 ring-primary bg-panel-dark/80' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleImageFile(file);
        }}
      >
        <div className="p-4 border-b border-border-dark font-medium flex justify-between items-center">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <img src="/logo-160.png" alt="WWI" className="w-6 h-6" />
            聊天室 ({role === 'pending' ? '連線中…' : isCaller ? '房主' : '訪客'})
          </span>
          <div className="flex gap-2 items-center">
            <span title="WebRTC 連線狀態" className={`text-xs px-2 py-1 rounded border whitespace-nowrap ${
              connectionState === 'connected' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
              connectionState === 'failed' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
              'bg-bg-dark text-text-secondary border-border-dark'
            }`}>
              {connectionState}
            </span>
            <span className="text-xs px-2 py-1 bg-bg-dark rounded text-text-secondary border border-border-dark whitespace-nowrap">
              安全連線
            </span>
          </div>
        </div>
        
        {/* 拖曳提示疊加層 */}
        {isDragging && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-panel-dark/90 backdrop-blur-sm pointer-events-none text-primary">
            <ImageIcon className="w-12 h-12 mb-2 animate-bounce" />
            <p className="font-medium">放開以上傳圖片</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {messages.map((msg) => {
            const isMine = (isCaller && msg.sender === 'caller') || (!isCaller && msg.sender === 'callee');
            return (
              <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div 
                  className={`max-w-[80%] px-3 py-2 rounded-xl text-left ${
                    isMine 
                      ? 'bg-primary text-white rounded-br-sm' 
                      : 'bg-bg-dark border border-border-dark rounded-bl-sm text-text-primary'
                  }`}
                >
                  <div className={`text-[10px] mb-0.5 ${isMine ? 'text-white/60' : 'text-text-secondary'}`}>
                    {msg.sender === 'caller' ? '房主' : '訪客'}
                  </div>
                  {msg.type === 'text' ? (
                    <p className="text-sm break-words leading-relaxed">{msg.content}</p>
                  ) : (
                    <img
                      src={msg.content}
                      alt="shared"
                      className="max-w-full rounded cursor-zoom-in hover:opacity-90 transition-opacity"
                      onClick={() => setPreviewImage(msg.content)}
                    />
                  )}
                </div>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>
        
        {/* 輸入區 */}
        <div className="px-3 py-2 border-t border-border-dark">
          <form 
            className="flex items-center gap-1.5" 
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(msgInput);
              setMsgInput('');
            }}
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={(e) => {
                const file = e.target.files?.[0];
                // 清空值，讓同一張圖可以再次選取
                e.target.value = '';
                if (file) handleImageFile(file);
              }}
            />
            <button 
              type="button" 
              className="shrink-0 p-1.5 hover:bg-border-dark rounded-md text-text-secondary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon className="w-4 h-4" />
            </button>
            <input
              type="text"
              placeholder="輸入訊息..."
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
              className="flex-1 min-w-0 bg-bg-dark border border-border-dark rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary text-left"
            />
            <button type="submit" className="shrink-0 bg-primary hover:bg-primary-hover px-3 py-1.5 rounded-md text-xs font-medium transition-colors">
              傳送
            </button>
          </form>
        </div>
      </div>

      {/* 圖片預覽 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage}
            alt="preview"
            className="max-w-[95vw] max-h-[90vh] object-contain rounded shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute top-4 right-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <a
              href={previewImage}
              download="remoteu-image.png"
              className="p-2 bg-panel-dark/80 hover:bg-border-dark rounded-lg text-text-primary transition-colors"
              title="下載"
            >
              <Download className="w-5 h-5" />
            </a>
            <button
              onClick={() => setPreviewImage(null)}
              className="p-2 bg-panel-dark/80 hover:bg-border-dark rounded-lg text-text-primary transition-colors"
              title="關閉 (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<JoinRoom />} />
        <Route path="/room/:id" element={<Room />} />
      </Routes>
    </Router>
  );
}

export default App;
