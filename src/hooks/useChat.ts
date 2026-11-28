import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { expireAt } from '../lib/expiry';
import { collection, query, orderBy, onSnapshot, addDoc } from 'firebase/firestore';

// Firestore 單一文件上限 1 MiB（1,048,576 bytes）。圖片以 Base64 data URL 存入，
// 編碼後約為原檔的 4/3 倍，因此原檔上限設 700KB（編碼後約 956KB），保留欄位名稱等餘裕。
export const MAX_IMAGE_KB = 700;
export const MAX_IMAGE_BYTES = MAX_IMAGE_KB * 1024;
const MAX_IMAGE_DATA_URL_CHARS = 1_000_000;

export interface ChatMessage {
  id: string;
  type: 'text' | 'image';
  content: string;
  sender: 'caller' | 'callee';
  timestamp: any;
}

// spaceId 由 useWebRTC 驗證房間後提供；尚未驗證（null）時不讀寫
export function useChat(spaceId: string | null, isCaller: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!spaceId) return;
    const messagesRef = collection(db, 'spaces', spaceId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChatMessage[];
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, [spaceId]);

  const sendMessage = async (content: string, type: 'text' | 'image' = 'text') => {
    if (!spaceId) return;
    if (!content.trim() && type === 'text') return;

    const messagesRef = collection(db, 'spaces', spaceId, 'messages');
    const sender = isCaller ? 'caller' : 'callee';
    await addDoc(messagesRef, {
      type,
      content,
      sender,
      timestamp: Date.now(),
      expireAt: expireAt(),
    });
  };

  // 讀檔或寫入 Firestore 失敗時會 reject，交給呼叫端提示使用者
  const sendImage = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('讀取圖片失敗'));
      reader.readAsDataURL(file);
    });
    if (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
      throw new Error(`圖片編碼後太大（上限約 ${MAX_IMAGE_KB}KB）`);
    }
    await sendMessage(dataUrl, 'image');
  };

  return { messages: spaceId ? messages : [], sendMessage, sendImage };
}
