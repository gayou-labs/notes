// 讓編輯器裡的元件（頁面連結、嵌入白板）可以讀到頁面清單、呼叫新增頁面等動作
import { useSyncExternalStore } from "react";

let pages = [];
let byId = {};
const listeners = new Set();

export function setPageIndex(list) {
  pages = list || [];
  byId = Object.fromEntries(pages.map((p) => [p.id, p]));
  listeners.forEach((l) => l());
}
const subscribe = (l) => (listeners.add(l), () => listeners.delete(l));
export const usePages = () => useSyncExternalStore(subscribe, () => pages);
export const usePage = (id) => useSyncExternalStore(subscribe, () => byId[id]);
export const getPage = (id) => byId[id];
export const getPages = () => pages;

// App 會把實際的動作放進來
export const actions = {
  createPage: async () => null, // ({ parentId, type, title, open }) => page
  updatePage: () => {},
  theme: "light",
};

export const titleOf = (p) => p?.title?.trim() || (p?.type === "board" ? "未命名白板" : "未命名");
export const iconOf = (p) => p?.icon || (p?.type === "board" ? "🖼️" : "📄");

// 找出內容裡連到的頁面（頁面連結、嵌入的白板）
export function linkedIds(blocks) {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if ((v.type === "pageLink" || v.type === "boardEmbed") && v.props?.pageId) out.add(v.props.pageId);
      for (const k in v) if (typeof v[k] === "object") walk(v[k]);
    }
  };
  walk(blocks);
  return [...out].sort();
}
