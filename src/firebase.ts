import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
// 使用 asia-east1（台灣）的具名資料庫 remoteu
export const db = getFirestore(app, 'remoteu');

// npm run dev:emulator 時連到本機 Firestore 模擬器（設定見 .env.emulator）
const emulatorHost = import.meta.env.VITE_FIRESTORE_EMULATOR as string | undefined;
if (emulatorHost) {
  const [host, port] = emulatorHost.split(':');
  connectFirestoreEmulator(db, host, Number(port));
}
export const storage = getStorage(app);
