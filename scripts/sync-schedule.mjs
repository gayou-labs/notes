// 用法：node scripts/sync-schedule.mjs <原本的 schedule.html>
// 把原本的排程表複製進筆記工具，只多加一行橋接程式，其餘完全不改。
import { readFileSync, writeFileSync } from "node:fs";
const src = process.argv[2];
if (!src) throw new Error("請指定 schedule.html 的路徑");
let html = readFileSync(src, "utf8");
const tag = '<script src="./schedule-bridge.js"></script>';
if (!html.includes(tag)) {
  if (!/<head[^>]*>/i.test(html)) throw new Error("找不到 <head>");
  html = html.replace(/<head[^>]*>/i, (m) => m + "\n" + tag);
}
writeFileSync(new URL("../public/schedule.html", import.meta.url), html);
console.log("已更新 public/schedule.html（" + html.length + " 字元）");
