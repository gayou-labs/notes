// 白板裡嵌入的筆記頁：可以直接編輯（像 Obsidian Canvas 的筆記卡片）
import { useEffect, useRef, useState } from "react";
import Editor from "./Editor.jsx";
import { store } from "./store.js";
import { actions, getPages, usePage, titleOf, iconOf } from "./registry.js";
import { linesOf } from "./lines.js";

export const noteLink = (id) => `${location.origin}${location.pathname}#/p/${id}`;
export const noteIdOf = (link) => {
  if (!link || !link.startsWith(location.origin)) return null;
  const m = /#\/p\/([\w-]+)$/.exec(link);
  return m ? m[1] : null;
};

export function NoteCard({ pageId, readOnly }) {
  const p = usePage(pageId);
  const ref = useRef(null);
  // 卡片裡捲動時捲筆記，不要移動白板
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e) => e.stopPropagation();
    el.addEventListener("wheel", stop, { passive: true });
    return () => el.removeEventListener("wheel", stop);
  }, []);
  if (!p || p.trashed)
    return (
      <div className="ncard" ref={ref}>
        <div className="ncard-empty">這一頁已刪除</div>
      </div>
    );
  return (
    <div className="ncard" ref={ref}>
      <div className="ncard-head" title={readOnly ? "" : "雙擊卡片就可以直接編輯"}>
        <span className="pi">{iconOf(p)}</span>
        <b className="ncard-title">{titleOf(p)}</b>
        {!readOnly && <span className="ncard-hint">雙擊編輯</span>}
        <a className="ncard-open" href={"#/p/" + pageId} title="開啟這一頁">
          ↗
        </a>
      </div>
      <div className="ncard-body">{readOnly ? <NoteText pageId={pageId} /> : <Editor pageId={pageId} theme={actions.theme} compact />}</div>
    </div>
  );
}

// 唯讀預覽（白板縮圖裡用，避免一層包一層）
function NoteText({ pageId }) {
  const [lines, setLines] = useState(null);
  useEffect(
    () =>
      store.subscribeContent(pageId, (data) => {
        const byId = Object.fromEntries(getPages().map((x) => [x.id, x]));
        setLines(linesOf({ type: "doc" }, data, byId));
      }),
    [pageId],
  );
  if (!lines) return null;
  return (
    <div className="ncard-text">
      {lines.slice(0, 40).map((parts, i) => (
        <p key={i}>{parts.map((x) => (x.link ? `[[${x.text}]]` : x.text)).join("")}</p>
      ))}
    </div>
  );
}

// 選擇要嵌入白板的筆記頁
export function NotePicker({ boardId, onPick, onClose }) {
  const [q, setQ] = useState("");
  const list = getPages()
    .filter((p) => p.type !== "board" && !p.trashed && titleOf(p).toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 30);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal top" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">把筆記頁放進白板</div>
        <input className="field" autoFocus placeholder="搜尋頁面，或輸入新頁面名稱…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="list">
          <button
            className="lrow"
            onClick={async () => {
              const p = await actions.createPage({ parentId: boardId, title: q.trim(), open: false });
              if (p) onPick(p.id);
            }}
          >
            <span className="pi">＋</span> 新增筆記頁{q.trim() ? `「${q.trim()}」` : ""}
          </button>
          {list.map((p) => (
            <button key={p.id} className="lrow" onClick={() => onPick(p.id)}>
              <span className="pi">{iconOf(p)}</span> {titleOf(p)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
