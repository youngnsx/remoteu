/*
 * 房間金鑰：由 roomId 與密碼推導出 Firestore 文件 ID（spaces/{key}）。
 *
 * Firestore 規則禁止 list spaces，所以只有同時知道 roomId 與密碼的人才算得出路徑、
 * 讀寫得到房間資料；密碼本身不會存進資料庫。
 * 用 PBKDF2 而不是單純雜湊，是為了讓線上逐一猜密碼的成本變高。
 *
 * 注意：crypto.subtle 只能在安全來源（https 或 localhost）使用。
 */
const ITERATIONS = 100_000;

export async function deriveRoomKey(roomId: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`remoteu:${roomId}`), iterations: ITERATIONS },
    baseKey,
    256,
  );
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}
