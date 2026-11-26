// Firestore 安全規則測試。執行：npm run test:rules（需要 Java 與 firebase-tools）
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, setDoc, updateDoc,
} from 'firebase/firestore';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

let env;
let db;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-remoteu',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  db = env.unauthenticatedContext().firestore();
});

after(() => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, 'spaces', KEY), { createdAt: 1 });
    await setDoc(doc(admin, 'rooms', 'oldroom'), { password: 'secret', createdAt: 1 });
    await setDoc(doc(admin, 'spaces', KEY, 'messages', 'm1'), { type: 'text', content: 'hi', sender: 'caller', timestamp: 1 });
  });
});

describe('spaces', () => {
  test('知道金鑰可以讀取房間', () => assertSucceeds(getDoc(doc(db, 'spaces', KEY))));
  test('不能列出所有房間', () => assertFails(getDocs(collection(db, 'spaces'))));
  test('金鑰格式不對不能讀取', () => assertFails(getDoc(doc(db, 'spaces', 'abc'))));
  test('可以建立只有 createdAt 的房間', () => assertSucceeds(setDoc(doc(db, 'spaces', OTHER_KEY), { createdAt: 2 })));
  test('不能把密碼存進房間', () => assertFails(setDoc(doc(db, 'spaces', OTHER_KEY), { createdAt: 2, password: 'x' })));
  test('不能用非 hex 金鑰建立房間', () => assertFails(setDoc(doc(db, 'spaces', 'my-room'), { createdAt: 2 })));
  test('可以寫入信令欄位', () => assertSucceeds(updateDoc(doc(db, 'spaces', KEY), {
    session: { id: 's1', offer: { type: 'offer', sdp: 'x' } },
    joinRequest: 3,
  })));
  test('可以刪除信令欄位', () => assertSucceeds(updateDoc(doc(db, 'spaces', KEY), { session: deleteField(), answer: deleteField() })));
  test('不能新增其他欄位', () => assertFails(updateDoc(doc(db, 'spaces', KEY), { foo: 1 })));
  test('不能修改 createdAt', () => assertFails(updateDoc(doc(db, 'spaces', KEY), { createdAt: 99 })));
  test('不能刪除房間', () => assertFails(deleteDoc(doc(db, 'spaces', KEY))));
});

describe('舊的 rooms 集合', () => {
  test('不能讀取（裡面有明文密碼）', () => assertFails(getDoc(doc(db, 'rooms', 'oldroom'))));
  test('不能建立', () => assertFails(setDoc(doc(db, 'rooms', 'newroom'), { password: 'x', createdAt: 1 })));
});

describe('candidates', () => {
  const cand = { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'u', session: 's1' };
  test('可以新增與讀取', async () => {
    const ref = await assertSucceeds(addDoc(collection(db, 'spaces', KEY, 'callerCandidates'), cand));
    await assertSucceeds(getDocs(collection(db, 'spaces', KEY, 'callerCandidates')));
    await assertSucceeds(deleteDoc(ref));
  });
  test('缺少 session 不能新增', () => {
    const { session: _s, ...noSession } = cand;
    return assertFails(addDoc(collection(db, 'spaces', KEY, 'calleeCandidates'), noSession));
  });
  test('瀏覽器產生的 null 欄位可以新增', () => assertSucceeds(addDoc(collection(db, 'spaces', KEY, 'calleeCandidates'), {
    ...cand, sdpMid: null, usernameFragment: null,
  })));
  test('不能夾帶其他欄位', () => assertFails(addDoc(collection(db, 'spaces', KEY, 'calleeCandidates'), { ...cand, extra: 1 })));
});

describe('messages', () => {
  const msg = { type: 'text', content: 'hello', sender: 'callee', timestamp: 2 };
  const msgs = () => collection(db, 'spaces', KEY, 'messages');
  test('可以讀取', () => assertSucceeds(getDocs(msgs())));
  test('可以新增文字訊息', () => assertSucceeds(addDoc(msgs(), msg)));
  test('可以新增 700KB 圖片（data URL 約 956KB）', () => assertSucceeds(addDoc(msgs(), {
    ...msg, type: 'image', content: 'data:image/png;base64,' + 'A'.repeat(Math.ceil(700 * 1024 / 3) * 4),
  })));
  test('不能新增未知類型', () => assertFails(addDoc(msgs(), { ...msg, type: 'html' })));
  test('不能偽造 sender', () => assertFails(addDoc(msgs(), { ...msg, sender: 'admin' })));
  test('不能超過 1,000,000 字元', () => assertFails(addDoc(msgs(), { ...msg, content: 'x'.repeat(1_000_001) })));
  test('不能修改訊息', () => assertFails(updateDoc(doc(db, 'spaces', KEY, 'messages', 'm1'), { content: 'edited' })));
  test('不能刪除訊息', () => assertFails(deleteDoc(doc(db, 'spaces', KEY, 'messages', 'm1'))));
});
