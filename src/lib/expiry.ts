import { Timestamp } from 'firebase/firestore';

/*
 * 資料保存期限：房間、訊息、ICE candidate 寫入時都帶 expireAt，
 * 由 Firestore TTL policy 自動刪除（實際刪除通常在到期後 24 小時內）。
 * 房間每次有人進入都會延長期限；訊息從送出起算。
 * 規則限制 expireAt 不能超過現在 + 25 小時（多 1 小時容許時鐘誤差）。
 */
export const DATA_TTL_MS = 24 * 60 * 60 * 1000;

export const expireAt = () => Timestamp.fromMillis(Date.now() + DATA_TTL_MS);
