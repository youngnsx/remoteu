#!/usr/bin/env node
/**
 * Remote U 用量與費用估算
 *
 * 從 Cloud Monitoring 取得 Firestore 讀 / 寫 / 刪次數，
 * 再從 Cloud Billing Catalog API 取得 asia-east1（台灣）的即時單價（新台幣），換算費用。
 *
 * 用法：
 *   npm run usage                 # 本月至今
 *   npm run usage -- --days 7     # 最近 7 天
 *   npm run usage -- --log        # 另外把結果附加到 docs/usage.md
 *
 * 需求：已 `gcloud auth login`，且帳號有 remote-u 的 Monitoring / Billing 讀取權限。
 */
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

const PROJECT = 'remote-u';
const DATABASE = 'remoteu';
const FIRESTORE_SERVICE = 'EE2C-7FAC-5E08';
// 具名資料庫沒有免費額度，使用不含 "(with free tier)" 的 SKU
const SKUS = {
  read: 'Cloud Firestore Read Ops Taiwan',
  write: 'Cloud Firestore Entity Writes Taiwan',
  delete: 'Cloud Firestore Entity Deletes Taiwan',
};
const METRICS = {
  read: 'firestore.googleapis.com/document/read_ops_count',
  write: 'firestore.googleapis.com/document/write_ops_count',
  delete: 'firestore.googleapis.com/document/delete_ops_count',
};
const LABELS = { read: '讀取', write: '寫入', delete: '刪除' };

const args = process.argv.slice(2);
const daysArg = args.includes('--days') ? Number(args[args.indexOf('--days') + 1]) : null;
const shouldLog = args.includes('--log');

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const headers = { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT };

async function getJson(url) {
  const res = await fetch(url, { headers });
  const data = await res.json();
  if (data.error) throw new Error(`${url}\n${data.error.message}`);
  return data;
}

// 計算區間：預設本月 1 日（台灣時間）至今
const end = new Date();
let start;
if (daysArg) {
  start = new Date(end.getTime() - daysArg * 86400_000);
} else {
  const tw = new Date(end.getTime() + 8 * 3600_000);
  start = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), 1) - 8 * 3600_000);
}
// 資料庫建立前沒有用量，區間起點不早於建立時間，避免平均每日被低估
const dbInfo = await getJson(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}`);
const dbCreated = new Date(dbInfo.createTime);
if (start < dbCreated) start = dbCreated;
// Monitoring 的 alignmentPeriod 上限約 104 天，整段區間用一個 bucket 加總
const periodSec = Math.max(60, Math.ceil((end - start) / 1000));

async function sumMetric(metricType) {
  const params = new URLSearchParams({
    filter: `metric.type="${metricType}" AND resource.label.database_id="${DATABASE}"`,
    'interval.startTime': start.toISOString(),
    'interval.endTime': end.toISOString(),
    'aggregation.alignmentPeriod': `${periodSec}s`,
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    'aggregation.crossSeriesReducer': 'REDUCE_SUM',
  });
  const data = await getJson(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?${params}`);
  let total = 0;
  for (const ts of data.timeSeries ?? []) {
    for (const p of ts.points) total += Number(p.value.int64Value ?? 0);
  }
  return total;
}

async function getUnitPrices() {
  const data = await getJson(
    `https://cloudbilling.googleapis.com/v1/services/${FIRESTORE_SERVICE}/skus?pageSize=5000&currencyCode=TWD`,
  );
  const prices = {};
  for (const [key, desc] of Object.entries(SKUS)) {
    const sku = data.skus.find(s => s.description === desc);
    if (!sku) throw new Error(`找不到 SKU：${desc}`);
    const rate = sku.pricingInfo[0].pricingExpression.tieredRates.at(-1).unitPrice;
    prices[key] = Number(rate.units ?? 0) + (rate.nanos ?? 0) / 1e9;
  }
  return prices;
}

const [prices, ...counts] = await Promise.all([getUnitPrices(), ...Object.values(METRICS).map(sumMetric)]);
const usage = Object.fromEntries(Object.keys(METRICS).map((k, i) => [k, counts[i]]));

const elapsedDays = (end - start) / 86400_000;
const fmt = n => n.toLocaleString('en-US');
const ntd = n => `NT$${n.toFixed(4)}`;

let total = 0;
const rows = Object.keys(METRICS).map(key => {
  const cost = usage[key] * prices[key];
  total += cost;
  return { key, count: usage[key], unit: prices[key] * 100_000, cost };
});
const perDay = total / elapsedDays;
const monthly = elapsedDays >= 1 ? `NT$${(perDay * 30).toFixed(2)}` : null;

const toTw = d => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
const range = `${toTw(start)} ~ ${toTw(end)}（台灣時間，${elapsedDays.toFixed(2)} 天）`;

console.log(`\nRemote U Firestore 用量（資料庫 ${DATABASE} / asia-east1）`);
console.log(`區間：${range}\n`);
console.log('項目    次數          單價 (每 10 萬次)   費用');
for (const r of rows) {
  console.log(`${LABELS[r.key]}    ${fmt(r.count).padEnd(12)}  NT$${r.unit.toFixed(2).padEnd(16)} ${ntd(r.cost)}`);
}
console.log(`\n合計：${ntd(total)}`);
console.log(
  monthly
    ? `平均每日：${ntd(perDay)}，以 30 天推估每月：${monthly}`
    : '資料累積不足 1 天，暫不推估每月費用（短時間測試會嚴重高估）',
);
console.log('（未含儲存空間與 Hosting 流量：目前資料量極小，Hosting 每日有 360MB 免費流量）\n');

if (shouldLog) {
  const file = new URL('../docs/usage.md', import.meta.url);
  if (!existsSync(file)) {
    writeFileSync(file, `# Remote U 用量紀錄

由 \`npm run usage -- --log\` 產生。資料來源：Cloud Monitoring（次數）、Cloud Billing Catalog（asia-east1 新台幣單價）。
費用僅含 Firestore 讀 / 寫 / 刪，未含儲存空間與 Hosting 流量。

| 記錄時間 | 區間 | 讀取 | 寫入 | 刪除 | 費用 | 推估每月 |
|---|---|---|---|---|---|---|
`);
  }
  appendFileSync(
    file,
    `| ${toTw(end)} | ${toTw(start)} ~ ${toTw(end)} | ${fmt(usage.read)} | ${fmt(usage.write)} | ${fmt(usage.delete)} | ${ntd(total)} | ${monthly ?? '不足 1 天'} |\n`,
  );
  console.log('已附加到 docs/usage.md');
}
