import { titleOf } from "./registry.js";

/* ---------- 內容 → 一段一段的文字（頁面連結以 [[標題]] 表示） ---------- */
function blockLines(body, byId) {
  let blocks = [];
  try {
    blocks = JSON.parse(body || "[]");
  } catch {}
  const out = [];
  const inline = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((c) => {
        if (c.type === "pageLink") return { link: c.props?.pageId, text: titleOf(byId[c.props?.pageId]) };
        if (c.type === "link") return { text: (c.content || []).map((x) => x.text || "").join("") };
        return { text: c.text || "" };
      })
      .filter((x) => x.text || x.link);
  const walk = (list) => {
    for (const b of list || []) {
      if (Array.isArray(b.content)) {
        const parts = inline(b.content);
        if (parts.length) out.push(parts);
      } else if (b.content?.type === "tableContent") {
        for (const row of b.content.rows || []) for (const cell of row.cells || []) {
          const parts = inline(Array.isArray(cell) ? cell : cell.content);
          if (parts.length) out.push(parts);
        }
      }
      if (b.type === "boardEmbed" && b.props?.pageId) out.push([{ text: "嵌入白板：" }, { link: b.props.pageId, text: titleOf(byId[b.props.pageId]) }]);
      walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

// 白板（Excalidraw）裡的文字與嵌入的筆記
function boardLines(body, byId) {
  let scene = null;
  try {
    scene = JSON.parse(body || "null");
  } catch {}
  const out = [];
  for (const e of scene?.elements || []) {
    if (e.type === "text" && e.text) out.push([{ text: e.text }]);
    const m = e.type === "embeddable" && /#\/p\/([\w-]+)/.exec(e.link || "");
    if (m) out.push([{ text: "白板裡嵌入：" }, { link: m[1], text: titleOf(byId[m[1]]) }]);
  }
  return out;
}

export function linesOf(page, data, byId) {
  return page?.type === "board" ? boardLines(data?.body, byId) : blockLines(data?.body, byId);
}

