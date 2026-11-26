import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc } from 'firebase/firestore';

export interface ChatMessage {
  id: string;
  type: 'text' | 'image';
  content: string;
  sender: 'caller' | 'callee';
  timestamp: any;
}

export function useChat(roomId: string, isCaller: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!roomId) return;
    const messagesRef = collection(db, 'rooms', roomId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChatMessage[];
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, [roomId]);

  const sendMessage = async (content: string, type: 'text' | 'image' = 'text') => {
    if (!content.trim() && type === 'text') return;
    
    const messagesRef = collection(db, 'rooms', roomId, 'messages');
    const sender = isCaller ? 'caller' : 'callee';
    await addDoc(messagesRef, {
      type,
      content,
      sender,
      timestamp: Date.now()
    });
  };

  const sendImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      sendMessage(base64, 'image');
    };
    reader.readAsDataURL(file);
  };

  return { messages, sendMessage, sendImage };
}
