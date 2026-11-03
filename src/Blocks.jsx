// 筆記裡的自訂內容：頁面連結、嵌入白板、嵌入 HTML／網頁
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { store } from "./store.js";
import { actions, usePage, usePages, titleOf, iconOf } from "./registry.js";


/* 自訂區塊裡有輸入框時，不要讓編輯器把按鍵、貼上當成筆記的操作 */
function useIsolate() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e) => e.stopPropagation();
    const evs = ["keydown", "keypress", "keyup", "beforeinput", "paste", "cut", "copy", "mousedown", "touchstart", "drop", "dragover"];
    evs.forEach((t) => el.addEventListener(t, stop));
    return () => evs.forEach((t) => el.removeEventListener(t, stop));
  }, []);
  return ref;
}

/* 拖曳右下角／右邊／下邊調整嵌入區塊的寬高（寬度用百分比，高度用像素） */
function Resizable({ width, height, minH = 140, onCommit, className, children, innerRef, ...rest }) {
  const [live, setLive] = useState(null);
  const box = useRef(null);
  const start = (e, mode) => {
    e.preventDefault();
    e.stopPropagation();
    const el = box.current;
    const parentW = el.parentElement.getBoundingClientRect().width || 1;
    const r = el.getBoundingClientRect();
    const sx = e.clientX,
      sy = e.clientY;
    const t = e.currentTarget;
    t.setPointerCapture(e.pointerId);
    let cur = { w: width, h: height };
    const move = (ev) => {
      const w = mode.includes("x") ? Math.max(25, Math.min(100, ((r.width + ev.clientX - sx) / parentW) * 100)) : width;
      const h = mode.includes("y") ? Math.max(minH, r.height + ev.clientY - sy) : height;
      cur = { w: Math.round(w), h: Math.round(h) };
      setLive(cur);
    };
    const up = () => {
      t.removeEventListener("pointermove", move);
      setLive(null);
      if (cur.w !== width || cur.h !== height) onCommit(cur);
    };
    t.addEventListener("pointermove", move);
    t.addEventListener("pointerup", up, { once: true });
    t.addEventListener("pointercancel", up, { once: true });
  };
  const w = live?.w ?? width,
    h = live?.h ?? height;
  return (
    <div
      ref={(n) => {
        box.current = n;
        if (innerRef) innerRef.current = n;
      }}
      className={"rsz " + className + (live ? " dragging" : "")}
      style={{ width: w + "%", height: h }}
      {...rest}
    >
      {children}
      <span className="rsz-h y" onPointerDown={(e) => start(e, "y")} onDoubleClick={() => onCommit({ w: 100, h: height })} />
      <span className="rsz-h x" onPointerDown={(e) => start(e, "x")} onDoubleClick={() => onCommit({ w: 100, h: height })} title="拖曳調整寬度，雙擊恢復全寬" />
      <span className="rsz-h xy" onPointerDown={(e) => start(e, "xy")} title="拖曳調整大小" />
      {live && <span className="rsz-size">{live.w}% × {live.h}px</span>}
    </div>
  );
}

/* ---------------- 頁面連結 ---------------- */
function PageChip({ pageId }) {
  const p = usePage(pageId);
  const gone = !p || p.trashed;
  return (
    <a
      className={"pagelink" + (gone ? " gone" : "")}
      href={gone ? undefined : "#/p/" + pageId}
      contentEditable={false}
      onClick={(e) => {
        if (gone) e.preventDefault();
      }}
      title={gone ? "這一頁已刪除" : "前往：" + titleOf(p)}
    >
      <span className="pl-i">{gone ? "⊘" : iconOf(p)}</span>
      {gone ? "已刪除的頁面" : titleOf(p)}
    </a>
  );
}

export const PageLink = createReactInlineContentSpec(
  { type: "pageLink", propSchema: { pageId: { default: "" } }, content: "none" },
  { render: (props) => <PageChip pageId={props.inlineContent.props.pageId} /> },
);

/* ---------------- 嵌入白板 ---------------- */
const BoardViewer = lazy(() => import("./BoardViewer.jsx"));


function BoardEmbedView({ block, editor }) {
  const { pageId, height, width } = block.props;
  const page = usePage(pageId);
  const pages = usePages();
  const [picking, setPicking] = useState(!pageId);
  const ref = useIsolate();
  const set = (props) => editor.updateBlock(block, { props });

  if (picking || !pageId || !page) {
    const boards = pages.filter((p) => p.type === "board" && !p.trashed).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return (
      <div className="emb be" ref={ref} contentEditable={false}>
        <div className="emb-head">🖼️ 選擇要嵌入的白板</div>
        <div className="be-pick">
          <button
            className="btn sm primary"
            onClick={async () => {
              const p = await actions.createPage({ type: "board", open: false });
              if (p) {
                set({ pageId: p.id });
                setPicking(false);
              }
            }}
          >
            ＋ 新增白板
          </button>
          {boards.map((p) => (
            <button
              key={p.id}
              className="btn sm"
              onClick={() => {
                set({ pageId: p.id });
                setPicking(false);
              }}
            >
              {iconOf(p)} {titleOf(p)}
            </button>
          ))}
          {pageId && (
            <button className="btn sm ghost" onClick={() => setPicking(false)}>
              取消
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Resizable
      className="emb be"
      innerRef={ref}
      contentEditable={false}
      width={+width || 100}
      height={+height || 400}
      onCommit={({ w, h }) => set({ width: w, height: h })}
    >
      <div className="emb-head">
        <a href={"#/p/" + pageId} className="emb-title">
          {iconOf(page)} {titleOf(page)}
        </a>
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => setPicking(true)}>
          更換
        </button>
        <a className="btn sm" href={"#/p/" + pageId}>
          開啟白板
        </a>
      </div>
      <Suspense fallback={<div className="be-msg">載入白板中…</div>}>
        <BoardViewer pageId={pageId} />
      </Suspense>
    </Resizable>
  );
}

export const BoardEmbed = createReactBlockSpec(
  { type: "boardEmbed", propSchema: { pageId: { default: "" }, height: { default: 400 }, width: { default: 100 } }, content: "none" },
  { render: (props) => <BoardEmbedView {...props} /> },
);

/* ---------------- 嵌入 HTML／網頁 ---------------- */
function safeUrl(u) {
  try {
    const url = new URL(u.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    if (url.origin === location.origin) return null; // 不允許嵌入筆記工具自己（避免取得你的資料）
    return url.href;
  } catch {
    return null;
  }
}

function HtmlEmbedView({ block, editor }) {
  const { mode, code, url, height } = block.props;
  const empty = mode === "url" ? !url : !code;
  const [editing, setEditing] = useState(empty);
  const [tab, setTab] = useState(mode || "html");
  const [err, setErr] = useState("");
  const ta = useRef(null);
  const inp = useRef(null);
  const ref = useIsolate();
  const set = (props) => editor.updateBlock(block, { props });

  const apply = () => {
    if (tab === "url") {
      const u = safeUrl(inp.current.value);
      if (!u) return setErr("請輸入 http:// 或 https:// 開頭的網址");
      set({ mode: "url", url: u });
    } else {
      const c = ta.current.value;
      if (!c.trim()) return setErr("請貼上 HTML 程式碼");
      if (c.length > 400_000) return setErr("程式碼太長（上限約 400KB）");
      set({ mode: "html", code: c });
    }
    setErr("");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="emb he" ref={ref} contentEditable={false}>
        <div className="emb-head">
          <div className="seg sm">
            <button className={tab === "html" ? "on" : ""} onClick={() => setTab("html")}>
              HTML 程式碼
            </button>
            <button className={tab === "url" ? "on" : ""} onClick={() => setTab("url")}>
              網址
            </button>
          </div>
        </div>
        {tab === "html" ? (
          <textarea
            ref={ta}
            className="he-code"
            defaultValue={code}
            spellCheck={false}
            placeholder={"貼上完整的 HTML，例如自己做的小工具、計算機、互動圖表…\n嵌入的內容在隔離的環境執行，讀不到你的筆記資料。"}
          />
        ) : (
          <input ref={inp} className="field" defaultValue={url} placeholder="https://…" />
        )}
        {tab === "url" && <p className="emb-note">有些網站不允許被嵌入（例如 Google、Facebook），會顯示空白或拒絕連線。</p>}
        {err && <p className="err-t left">{err}</p>}
        <div className="row">
          <button className="btn sm primary" onClick={apply}>
            套用
          </button>
          {!empty && (
            <button className="btn sm" onClick={() => setEditing(false)}>
              取消
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Resizable
      className="emb he"
      innerRef={ref}
      contentEditable={false}
      width={+block.props.width || 100}
      height={+height || 460}
      minH={120}
      onCommit={({ w, h }) => set({ width: w, height: h })}
    >
      <div className="emb-head hov-bar">
        <span className="emb-title">{mode === "url" ? "🌐 " + new URL(url).hostname : "🧩 HTML"}</span>
        <span className="grow" />
        {mode === "url" && (
          <a className="btn sm ghost" href={url} target="_blank" rel="noopener noreferrer">
            新視窗開啟
          </a>
        )}
        <button
          className="btn sm"
          onClick={() => {
            setTab(mode || "html");
            setEditing(true);
          }}
        >
          編輯
        </button>
      </div>
      {mode === "url" ? (
        <iframe
          className="he-frame"
          src={url}
          title="嵌入網頁"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
          allow="fullscreen; clipboard-write"
          referrerPolicy="no-referrer"
        />
      ) : (
        <HtmlFrame code={code} storeKey={"embed-" + block.id} />
      )}
    </Resizable>
  );
}

/* 嵌入的 HTML 在隔離環境執行，本來不能用瀏覽器儲存空間。
   這裡給它一個替身 localStorage：資料存進你的資料庫，換裝置也看得到。 */
function withStorageShim(code, initial) {
  const json = JSON.stringify(initial || {}).replace(/</g, "\\u003c");
  const shim =
    "<script>(function(){var D=" +
    json +
    ";var t=null;function send(){clearTimeout(t);t=setTimeout(function(){parent.postMessage({__notesEmbedStore:1,data:D},'*')},300)}" +
    "var api={getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(D,k)?D[k]:null},setItem:function(k,v){D[String(k)]=String(v);send()}," +
    "removeItem:function(k){delete D[String(k)];send()},clear:function(){D={};send()},key:function(i){return Object.keys(D)[i]||null}};" +
    "var S=new Proxy(api,{get:function(o,k){if(k==='length')return Object.keys(D).length;if(k in o)return o[k];return api.getItem(k)}," +
    "set:function(o,k,v){api.setItem(k,v);return true},deleteProperty:function(o,k){api.removeItem(k);return true}});" +
    "var M={},T=new Proxy({getItem:function(k){return M[k]===undefined?null:M[k]},setItem:function(k,v){M[k]=String(v)},removeItem:function(k){delete M[k]},clear:function(){M={}}},{get:function(o,k){return k==='length'?Object.keys(M).length:o[k]}});" +
    "try{Object.defineProperty(window,'localStorage',{value:S,configurable:true})}catch(e){}" +
    "try{Object.defineProperty(window,'sessionStorage',{value:T,configurable:true})}catch(e){}})();<\/script>";
  if (/<head[^>]*>/i.test(code)) return code.replace(/<head[^>]*>/i, (m) => m + shim);
  if (/<!doctype[^>]*>/i.test(code)) return code.replace(/<!doctype[^>]*>/i, (m) => m + shim);
  return shim + code;
}

function HtmlFrame({ code, storeKey }) {
  const [init, setInit] = useState(undefined);
  const frame = useRef(null);
  useEffect(() => {
    let alive = true;
    store
      .getKV(storeKey)
      .then((v) => {
        let d = {};
        try {
          d = v ? JSON.parse(v) : {};
        } catch {}
        if (alive) setInit(d);
      })
      .catch(() => alive && setInit({}));
    return () => {
      alive = false;
    };
  }, [storeKey]);
  useEffect(() => {
    const on = (e) => {
      if (!frame.current || e.source !== frame.current.contentWindow || !e.data?.__notesEmbedStore) return;
      const json = JSON.stringify(e.data.data || {});
      if (json.length > 500_000) return console.warn("嵌入的資料太大，沒有保存");
      store.putKV(storeKey, json).catch(() => {});
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [storeKey]);
  if (init === undefined) return <div className="be-msg">載入中…</div>;
  return (
    <iframe
      ref={frame}
      className="he-frame"
      srcDoc={withStorageShim(code, init)}
      title="嵌入 HTML"
      // 沒有 allow-same-origin：嵌入的程式碼和筆記工具完全隔離，讀不到登入狀態與資料
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
      allow="fullscreen; clipboard-write"
    />
  );
}

export const HtmlEmbed = createReactBlockSpec(
  {
    type: "htmlEmbed",
    propSchema: { mode: { default: "html" }, code: { default: "" }, url: { default: "" }, height: { default: 460 }, width: { default: 100 } },
    content: "none",
  },
  { render: (props) => <HtmlEmbedView {...props} /> },
);
