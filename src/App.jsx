import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  store,
  CHANNEL,
  cloudConfigured,
  uid16,
  onSyncStatus,
  exportAll,
  importAll,
  readLocalData,
  clearLocalData,
} from "./store.js";
import Editor from "./Editor.jsx";

const Board = lazy(() => import("./Board.jsx"));
const Schedule = lazy(() => import("./Schedule.jsx"));

const EMOJIS = "📝 📒 📓 📔 📕 📗 📘 📙 📚 📄 📋 📌 📎 🗂️ 🗓️ 📅 ⏰ ✅ ☑️ ⭐ 💡 🔖 🏷️ 🧠 💬 🎯 🚀 🛠️ 🔧 ⚙️ 💻 🖥️ 📱 🎨 🖌️ ✏️ 🖍️ 📷 🎬 🎵 🍀 🌱 🌸 🔥 💧 ☀️ 🌙 ❤️ 🧡 💛 💚 💙 💜 🖤 🏠 ✈️ 🍳 ☕ 🐱 🐶".split(" ");

/* ---------------- 小工具 ---------------- */
const now = () => Date.now();
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0);
const titleOf = (p) => p?.title?.trim() || (p?.type === "board" ? "未命名白板" : "未命名");
const iconOf = (p) => p?.icon || (p?.type === "board" ? "🖼️" : "📄");

function useHashRoute() {
  const get = () => {
    const h = location.hash.replace(/^#\/?/, "");
    const [view, id] = h.split("/");
    return { view: view || "home", id: id || null };
  };
  const [r, setR] = useState(get);
  useEffect(() => {
    const on = () => setR(get());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}
const go = (path) => (location.hash = "#/" + path);

function useTheme() {
  const [pref, setPref] = useState(() => {
    try {
      return localStorage.getItem("notes-theme") || "system";
    } catch {
      return "system";
    }
  });
  const [sysDark, setSysDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSysDark(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  const theme = pref === "system" ? (sysDark ? "dark" : "light") : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#191919" : "#ffffff");
  }, [theme]);
  const set = (v) => {
    setPref(v);
    try {
      localStorage.setItem("notes-theme", v);
    } catch {}
  };
  return [theme, pref, set];
}

const isMobile = () => matchMedia("(max-width: 820px)").matches;

/* ---------------- App ---------------- */
export default function App() {
  const [user, setUser] = useState(undefined);
  const [pages, setPages] = useState(null);
  const [sync, setSync] = useState({ inflight: 0, online: true, error: null });
  const [sideOpen, setSideOpen] = useState(() => !isMobile());
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, themePref, setTheme] = useTheme();
  const route = useHashRoute();

  useEffect(() => store.init(setUser), []);
  useEffect(() => onSyncStatus(setSync), []);
  useEffect(() => {
    if (!user) return;
    return store.subscribePages(setPages);
  }, [user]);

  // 手機：換頁後收起側邊欄
  useEffect(() => {
    if (isMobile()) setSideOpen(false);
  }, [route.view, route.id]);

  useEffect(() => {
    const on = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        setSideOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const byId = useMemo(() => Object.fromEntries((pages || []).map((p) => [p.id, p])), [pages]);
  const isGone = useCallback(
    (p) => {
      for (let i = 0, q = p; q && i < 50; i++, q = byId[q.parentId]) if (q.trashed) return true;
      return false;
    },
    [byId],
  );
  const kids = useCallback(
    (parentId) => (pages || []).filter((p) => (p.parentId || null) === parentId && !p.trashed).sort(byOrder),
    [pages],
  );

  const createPage = async ({ parentId = null, type = "doc", open = true } = {}) => {
    const siblings = kids(parentId);
    const p = {
      id: uid16(),
      title: "",
      icon: "",
      type,
      parentId,
      order: (siblings.at(-1)?.order ?? 0) + 1,
      createdAt: now(),
      updatedAt: now(),
      trashed: false,
      favorite: false,
      fullWidth: type === "board",
    };
    store.putPage(p).catch(() => {});
    if (parentId) setExpanded(parentId, true);
    if (open) go("p/" + p.id);
    return p;
  };
  const updatePage = (id, patch) => store.putPage({ id, ...patch, updatedAt: now() }).catch(() => {});
  const touch = (id) => updatePage(id, {});

  const [expandedSet, setExpandedSet] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("notes-expanded") || "[]"));
    } catch {
      return new Set();
    }
  });
  const setExpanded = (id, v) =>
    setExpandedSet((s) => {
      const n = new Set(s);
      v ? n.add(id) : n.delete(id);
      try {
        localStorage.setItem("notes-expanded", JSON.stringify([...n]));
      } catch {}
      return n;
    });

  if (user === undefined) return <Splash text="載入中…" />;
  if (user === null) return <Login />;
  if (pages === null) return <Splash text={sync.error ? "讀取失敗：" + sync.error : "讀取筆記中…"} />;

  const page = route.view === "p" ? byId[route.id] : null;
  const ctx = { pages, byId, kids, isGone, createPage, updatePage, touch, expandedSet, setExpanded, user, theme };

  let main;
  if (route.view === "p") {
    main = page ? <PageView key={page.id} page={page} ctx={ctx} /> : <Empty text="找不到這一頁，可能已被永久刪除。" />;
  } else if (route.view === "trash") main = <TrashView ctx={ctx} />;
  else if (route.view === "settings")
    main = <SettingsView ctx={ctx} themePref={themePref} setTheme={setTheme} sync={sync} />;
  else if (route.view === "schedule")
    main = (
      <Suspense fallback={<div className="loading">載入排程…</div>}>
        <Schedule theme={theme} />
      </Suspense>
    );
  else main = <HomeView ctx={ctx} />;

  const crumbs = page ? breadcrumb(page, byId) : [];
  const fullBleed = route.view === "schedule" || page?.type === "board";

  return (
    <div className={"app" + (sideOpen ? " side-open" : "")}>
      <Sidebar ctx={ctx} route={route} sync={sync} onSearch={() => setSearchOpen(true)} onClose={() => setSideOpen(false)} />
      <div className="scrim" onClick={() => setSideOpen(false)} />
      <main className="main">
        <header className="topbar">
          <button className="ibtn" title="側邊欄 (Ctrl+\)" onClick={() => setSideOpen((v) => !v)}>
            <Icon name="menu" />
          </button>
          <nav className="crumbs">
            {route.view === "p" &&
              crumbs.map((c, i) => (
                <span key={c.id} className="crumb">
                  {i > 0 && <span className="sep">/</span>}
                  <a href={"#/p/" + c.id}>
                    <span className="ci">{iconOf(c)}</span>
                    {titleOf(c)}
                  </a>
                </span>
              ))}
            {route.view === "trash" && <span className="crumb">垃圾桶</span>}
            {route.view === "settings" && <span className="crumb">設定</span>}
            {route.view === "schedule" && <span className="crumb">🗓️ 排程</span>}
          </nav>
          <SyncDot sync={sync} />
          {page && <PageMenu page={page} ctx={ctx} />}
        </header>
        {sync.error && /permission|權限|insufficient/i.test(sync.error) && (
          <div className="banner err">
            這個 Google 帳號沒有讀寫權限。請確認登入的是設定在資料庫規則裡的帳號。
            <button className="btn sm" onClick={() => store.signOut()}>
              換帳號
            </button>
          </div>
        )}
        {CHANNEL === "preview" && (
          <div className="banner preview">
            預覽版：這裡用的是獨立的測試資料，怎麼改都不會影響正式版。
            <a className="btn sm" href="../">回正式版</a>
          </div>
        )}
        {!cloudConfigured && route.view !== "settings" && (
          <div className="banner">本機試用模式：資料只存在這台裝置。設定好 Firebase 後就會改成雲端同步。</div>
        )}
        <div className={"content" + (fullBleed ? " bleed" : "")}>{main}</div>
      </main>
      {searchOpen && <SearchDialog ctx={ctx} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

function breadcrumb(page, byId) {
  const out = [];
  for (let q = page, i = 0; q && i < 50; q = byId[q.parentId], i++) out.unshift(q);
  return out;
}

/* ---------------- 側邊欄 ---------------- */
function Sidebar({ ctx, route, sync, onSearch, onClose }) {
  const { kids, pages, createPage, isGone } = ctx;
  const favs = pages.filter((p) => p.favorite && !isGone(p)).sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  const roots = kids(null);
  return (
    <aside className="side">
      <div className="side-head">
        <div className="brand">筆記{CHANNEL === "preview" && <span className="tag-preview">預覽</span>}</div>
        <button className="ibtn" title="關閉側邊欄" onClick={onClose}>
          <Icon name="left" />
        </button>
      </div>
      <div className="side-actions">
        <button className="srow" onClick={onSearch}>
          <Icon name="search" /> 搜尋 <kbd>Ctrl K</kbd>
        </button>
        <a className={"srow" + (route.view === "home" ? " on" : "")} href="#/">
          <Icon name="home" /> 首頁
        </a>
        <a className={"srow" + (route.view === "schedule" ? " on" : "")} href="#/schedule">
          <Icon name="cal" /> 排程
        </a>
      </div>
      <div className="side-scroll">
        {favs.length > 0 && (
          <>
            <div className="sec">收藏</div>
            {favs.map((p) => (
              <a key={p.id} className={"srow" + (route.id === p.id ? " on" : "")} href={"#/p/" + p.id}>
                <span className="pi">{iconOf(p)}</span>
                <span className="pt">{titleOf(p)}</span>
              </a>
            ))}
          </>
        )}
        <div className="sec">
          頁面
          <span className="sec-actions">
            <button className="ibtn xs" title="新增白板" onClick={() => createPage({ type: "board" })}>
              <Icon name="board" />
            </button>
            <button className="ibtn xs" title="新增頁面" onClick={() => createPage()}>
              <Icon name="plus" />
            </button>
          </span>
        </div>
        <Tree parentId={null} depth={0} ctx={ctx} route={route} />
        {roots.length === 0 && <div className="side-empty">還沒有頁面，按上面的 ＋ 新增</div>}
      </div>
      <div className="side-foot">
        <a className={"srow" + (route.view === "trash" ? " on" : "")} href="#/trash">
          <Icon name="trash" /> 垃圾桶
        </a>
        <a className={"srow" + (route.view === "settings" ? " on" : "")} href="#/settings">
          <Icon name="gear" /> 設定
        </a>
        <button className="srow new" onClick={() => createPage()}>
          <Icon name="plus" /> 新頁面
        </button>
      </div>
    </aside>
  );
}

let dragId = null;
function Tree({ parentId, depth, ctx, route }) {
  const { kids, expandedSet, setExpanded, createPage, updatePage, byId } = ctx;
  const [drop, setDrop] = useState(null); // {id, pos}
  const list = kids(parentId);

  const isAncestor = (aId, bId) => {
    for (let q = byId[bId], i = 0; q && i < 50; q = byId[q.parentId], i++) if (q.id === aId) return true;
    return false;
  };
  const onDrop = (target, pos) => {
    const id = dragId;
    dragId = null;
    setDrop(null);
    if (!id || id === target.id || isAncestor(id, target.id)) return;
    if (pos === "in") {
      const sib = kids(target.id);
      updatePage(id, { parentId: target.id, order: (sib.at(-1)?.order ?? 0) + 1 });
      setExpanded(target.id, true);
    } else {
      const sib = kids(target.parentId || null).filter((p) => p.id !== id);
      const i = sib.findIndex((p) => p.id === target.id);
      const before = pos === "before" ? sib[i - 1] : sib[i];
      const after = pos === "before" ? sib[i] : sib[i + 1];
      const lo = before?.order ?? (after?.order ?? 1) - 1;
      const hi = after?.order ?? lo + 2;
      updatePage(id, { parentId: target.parentId || null, order: (lo + hi) / 2 });
    }
  };

  return list.map((p) => {
    const open = expandedSet.has(p.id);
    const hasKids = kids(p.id).length > 0;
    const d = drop?.id === p.id ? drop.pos : null;
    return (
      <div key={p.id}>
        <div
          className={"trow" + (route.id === p.id ? " on" : "") + (d ? " drop-" + d : "")}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onDragStart={(e) => {
            dragId = p.id;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", p.id);
          }}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            setDrop({ id: p.id, pos: y < 0.28 ? "before" : y > 0.72 ? "after" : "in" });
          }}
          onDragLeave={() => setDrop((v) => (v?.id === p.id ? null : v))}
          onDrop={(e) => {
            e.preventDefault();
            onDrop(p, d || "in");
          }}
        >
          <button className={"tog" + (open ? " open" : "")} onClick={() => setExpanded(p.id, !open)} aria-label="展開">
            {hasKids ? <Icon name="chev" /> : <span className="dot" />}
          </button>
          <a className="tlink" href={"#/p/" + p.id}>
            <span className="pi">{iconOf(p)}</span>
            <span className="pt">{titleOf(p)}</span>
          </a>
          <button className="ibtn xs hov" title="新增子頁面" onClick={() => createPage({ parentId: p.id })}>
            <Icon name="plus" />
          </button>
        </div>
        {open && <Tree parentId={p.id} depth={depth + 1} ctx={ctx} route={route} />}
      </div>
    );
  });
}

/* ---------------- 頁面 ---------------- */
function PageView({ page, ctx }) {
  const { updatePage, kids, touch, theme } = ctx;
  const sub = kids(page.id);
  const lastTouch = useRef(0);
  const onTextChange = () => {
    if (now() - lastTouch.current > 30_000) {
      lastTouch.current = now();
      touch(page.id);
    }
  };

  if (page.type === "board") {
    return (
      <div className="board-page">
        <div className="board-title">
          <IconPicker page={page} ctx={ctx} small />
          <TitleInput page={page} ctx={ctx} small />
        </div>
        <Suspense fallback={<div className="loading">載入白板中…</div>}>
          <Board pageId={page.id} theme={theme} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className={"page" + (page.fullWidth ? " full" : "") + (page.small ? " small" : "")}>
      <div className="page-head">
        <IconPicker page={page} ctx={ctx} />
        <TitleInput page={page} ctx={ctx} />
      </div>
      <Editor pageId={page.id} theme={theme} onTextChange={onTextChange} />
      <div className="subpages">
        {sub.length > 0 && <div className="sub-label">子頁面</div>}
        {sub.map((p) => (
          <a key={p.id} className="subrow" href={"#/p/" + p.id}>
            <span className="pi">{iconOf(p)}</span> {titleOf(p)}
          </a>
        ))}
        <div className="sub-add">
          <button className="btn ghost sm" onClick={() => ctx.createPage({ parentId: page.id })}>
            ＋ 子頁面
          </button>
          <button className="btn ghost sm" onClick={() => ctx.createPage({ parentId: page.id, type: "board" })}>
            ＋ 子白板
          </button>
        </div>
      </div>
    </div>
  );
}

function TitleInput({ page, ctx, small }) {
  const [v, setV] = useState(page.title || "");
  const ref = useRef(null);
  const editing = useRef(false);
  const t = useRef(null);
  useEffect(() => {
    if (!editing.current) setV(page.title || "");
  }, [page.title]);
  useEffect(() => {
    if (!page.title && ref.current && now() - (page.createdAt || 0) < 5000) ref.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && !small) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [v, small]);
  const commit = (val) => {
    clearTimeout(t.current);
    if (val !== (page.title || "")) ctx.updatePage(page.id, { title: val });
  };
  const props = {
    ref,
    className: small ? "title-sm" : "title",
    value: v,
    placeholder: page.type === "board" ? "未命名白板" : "未命名",
    onFocus: () => (editing.current = true),
    onBlur: () => {
      editing.current = false;
      commit(v);
    },
    onChange: (e) => {
      const val = e.target.value.replace(/\n/g, "");
      setV(val);
      clearTimeout(t.current);
      t.current = setTimeout(() => commit(val), 600);
    },
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit(v);
        if (small) e.currentTarget.blur();
        else document.querySelector(".bn-editor")?.focus();
      }
    },
  };
  return small ? <input {...props} /> : <textarea rows={1} {...props} />;
}

function IconPicker({ page, ctx, small }) {
  const [open, setOpen] = useState(false);
  const pick = (icon) => {
    ctx.updatePage(page.id, { icon });
    setOpen(false);
  };
  return (
    <div className="iconpick">
      {small || page.icon ? (
        <button className={small ? "picon sm" : "picon"} onClick={() => setOpen((v) => !v)} title="更換圖示">
          {iconOf(page)}
        </button>
      ) : (
        <button className="add-icon" onClick={() => setOpen((v) => !v)}>
          ☺ 新增圖示
        </button>
      )}
      {open && (
        <>
          <div className="pop-scrim" onClick={() => setOpen(false)} />
          <div className="pop emoji">
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => pick(e)}>
                {e}
              </button>
            ))}
            <button className="wide" onClick={() => pick("")}>
              移除圖示
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PageMenu({ page, ctx }) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const { updatePage, createPage } = ctx;
  const close = () => setOpen(false);
  return (
    <div className="menuwrap">
      <button className={"ibtn" + (page.favorite ? " fav" : "")} title={page.favorite ? "取消收藏" : "收藏"} onClick={() => updatePage(page.id, { favorite: !page.favorite })}>
        <Icon name={page.favorite ? "star-on" : "star"} />
      </button>
      <button className="ibtn" title="更多" onClick={() => setOpen((v) => !v)}>
        <Icon name="more" />
      </button>
      {open && (
        <>
          <div className="pop-scrim" onClick={close} />
          <div className="pop menu">
            {page.type !== "board" && (
              <>
                <label className="mrow">
                  <span>全寬版面</span>
                  <Toggle on={!!page.fullWidth} onChange={(v) => updatePage(page.id, { fullWidth: v })} />
                </label>
                <label className="mrow">
                  <span>小字</span>
                  <Toggle on={!!page.small} onChange={(v) => updatePage(page.id, { small: v })} />
                </label>
                <hr />
              </>
            )}
            <button className="mrow" onClick={() => (close(), createPage({ parentId: page.id }))}>
              新增子頁面
            </button>
            <button className="mrow" onClick={() => (close(), createPage({ parentId: page.id, type: "board" }))}>
              新增子白板
            </button>
            <button className="mrow" onClick={() => (close(), setMoving(true))}>
              移動到…
            </button>
            <hr />
            <button
              className="mrow danger"
              onClick={() => {
                close();
                updatePage(page.id, { trashed: true, trashedAt: now() });
                go(page.parentId ? "p/" + page.parentId : "");
              }}
            >
              移到垃圾桶
            </button>
            <div className="mmeta">最後編輯：{new Date(page.updatedAt || page.createdAt).toLocaleString("zh-TW")}</div>
          </div>
        </>
      )}
      {moving && <MoveDialog page={page} ctx={ctx} onClose={() => setMoving(false)} />}
    </div>
  );
}

function MoveDialog({ page, ctx, onClose }) {
  const { pages, byId, isGone, kids, updatePage } = ctx;
  const [q, setQ] = useState("");
  const isDesc = (id) => {
    for (let x = byId[id], i = 0; x && i < 50; x = byId[x.parentId], i++) if (x.id === page.id) return true;
    return false;
  };
  const targets = pages
    .filter((p) => p.type !== "board" && !isGone(p) && !isDesc(p.id))
    .filter((p) => titleOf(p).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  const move = (parentId) => {
    const sib = kids(parentId);
    updatePage(page.id, { parentId, order: (sib.at(-1)?.order ?? 0) + 1 });
    if (parentId) ctx.setExpanded(parentId, true);
    onClose();
  };
  return (
    <Modal onClose={onClose} title={`把「${titleOf(page)}」移動到`}>
      <input className="field" autoFocus placeholder="搜尋頁面…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        <button className="lrow" onClick={() => move(null)}>
          <span className="pi">🏠</span> 最上層
        </button>
        {targets.map((p) => (
          <button key={p.id} className="lrow" onClick={() => move(p.id)} disabled={p.id === page.parentId}>
            <span className="pi">{iconOf(p)}</span> {titleOf(p)}
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ---------------- 首頁 / 垃圾桶 / 設定 ---------------- */
function HomeView({ ctx }) {
  const { pages, isGone, createPage, byId } = ctx;
  const recent = pages
    .filter((p) => !isGone(p))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 12);
  const hour = new Date().getHours();
  const hi = hour < 5 ? "夜深了" : hour < 12 ? "早安" : hour < 18 ? "午安" : "晚安";
  return (
    <div className="page home">
      <h1 className="home-hi">{hi}</h1>
      <div className="quick">
        <button className="qcard" onClick={() => createPage()}>
          <span>📄</span>新頁面
        </button>
        <button className="qcard" onClick={() => createPage({ type: "board" })}>
          <span>🖼️</span>新白板
        </button>
        <a className="qcard" href="#/schedule">
          <span>🗓️</span>排程
        </a>
      </div>
      <h2 className="h2">最近編輯</h2>
      {recent.length === 0 && <p className="muted">還沒有任何頁面。</p>}
      <div className="recent">
        {recent.map((p) => (
          <a key={p.id} className="rcard" href={"#/p/" + p.id}>
            <span className="ri">{iconOf(p)}</span>
            <span className="rt">{titleOf(p)}</span>
            <span className="rm">
              {p.parentId && byId[p.parentId] ? titleOf(byId[p.parentId]) + " · " : ""}
              {timeAgo(p.updatedAt || p.createdAt)}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function timeAgo(t) {
  const s = (now() - t) / 1000;
  if (s < 60) return "剛剛";
  if (s < 3600) return Math.floor(s / 60) + " 分鐘前";
  if (s < 86400) return Math.floor(s / 3600) + " 小時前";
  if (s < 86400 * 7) return Math.floor(s / 86400) + " 天前";
  return new Date(t).toLocaleDateString("zh-TW");
}

function TrashView({ ctx }) {
  const { pages, byId, updatePage } = ctx;
  const trashed = pages.filter((p) => p.trashed).sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
  const descendants = (id) => {
    const out = [];
    const walk = (pid) =>
      pages.filter((p) => p.parentId === pid).forEach((p) => {
        out.push(p.id);
        walk(p.id);
      });
    walk(id);
    return out;
  };
  const purge = async (p) => {
    const ids = [p.id, ...descendants(p.id)];
    if (!confirm(`永久刪除「${titleOf(p)}」${ids.length > 1 ? `和底下 ${ids.length - 1} 個子頁面` : ""}？刪除後無法復原。`)) return;
    for (const id of ids) await store.removePage(id).catch(() => {});
  };
  const restore = (p) => {
    const parentOk = !p.parentId || (byId[p.parentId] && !byId[p.parentId].trashed);
    updatePage(p.id, { trashed: false, ...(parentOk ? {} : { parentId: null }) });
  };
  return (
    <div className="page">
      <h1 className="h1">垃圾桶</h1>
      <p className="muted">刪除的頁面會先放在這裡，可以還原。永久刪除後就救不回來了。</p>
      {trashed.length === 0 && <p className="muted">垃圾桶是空的。</p>}
      <div className="list">
        {trashed.map((p) => (
          <div key={p.id} className="lrow static">
            <span className="pi">{iconOf(p)}</span>
            <span className="grow">{titleOf(p)}</span>
            <span className="muted sm">{timeAgo(p.trashedAt || p.updatedAt)}</span>
            <button className="btn sm" onClick={() => restore(p)}>
              還原
            </button>
            <button className="btn sm danger" onClick={() => purge(p)}>
              永久刪除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsView({ ctx, themePref, setTheme, sync }) {
  const { pages, user } = ctx;
  const [msg, setMsg] = useState("");
  const [localData, setLocalData] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (cloudConfigured) readLocalData().then((d) => d && d.pages.length && setLocalData(d));
  }, []);

  const doExport = async () => {
    setMsg("匯出中…");
    try {
      const data = await exportAll(pages);
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `筆記備份-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setMsg("已下載備份檔。");
    } catch (e) {
      setMsg("匯出失敗：" + e.message);
    }
  };
  const doImport = async (file) => {
    if (!file) return;
    if (!confirm("匯入會把備份裡的頁面加進來，同一頁會用備份的版本覆蓋。確定要匯入嗎？")) return;
    setMsg("匯入中…");
    try {
      await importAll(JSON.parse(await file.text()));
      setMsg("匯入完成。");
    } catch (e) {
      setMsg("匯入失敗：" + e.message);
    }
  };
  const migrate = async () => {
    setMsg("上傳中…");
    try {
      await importAll(localData);
      await clearLocalData();
      setLocalData(null);
      setMsg(`已把本機試用的 ${localData.pages.length} 個頁面上傳到雲端。`);
    } catch (e) {
      setMsg("上傳失敗：" + e.message);
    }
  };

  return (
    <div className="page">
      <h1 className="h1">設定</h1>

      <section className="card">
        <h3>帳號與同步</h3>
        {cloudConfigured ? (
          <>
            <p>
              雲端模式 · 已登入 <b>{user.email}</b>
            </p>
            <p className="muted sm">資料存在你的 Firebase，只有這個帳號能讀寫。沒網路時也能編輯，連線後自動同步。</p>
            <p className="muted sm">
              同步狀態：{!sync.online ? "離線中（改動會在連線後上傳）" : sync.inflight ? `同步中（${sync.inflight}）` : "已同步"}
              {sync.error ? `；最近錯誤：${sync.error}` : ""}
            </p>
            <button className="btn" onClick={() => store.signOut()}>
              登出
            </button>
          </>
        ) : (
          <>
            <p>
              <b>本機試用模式</b>：資料只存在這台裝置的瀏覽器。
            </p>
            <p className="muted sm">
              設定好 Firebase 之後會改成雲端同步，到時可以在這裡把試用期間的資料一鍵上傳。清除瀏覽器資料會讓本機資料消失，重要內容請先匯出備份。
            </p>
          </>
        )}
        {localData && (
          <div className="banner">
            這台裝置上有 {localData.pages.length} 個本機試用時建立的頁面。
            <button className="btn sm primary" onClick={migrate}>
              上傳到雲端
            </button>
          </div>
        )}
      </section>

      {CHANNEL === "preview" && cloudConfigured && (
        <section className="card">
          <h3>預覽版測試資料</h3>
          <p className="muted sm">把正式版目前的筆記、白板、排程複製一份到預覽版，方便用真實資料測試新功能。正式資料不會被修改。</p>
          <button
            className="btn"
            onClick={async () => {
              if (!confirm("用正式版的資料覆蓋預覽版的測試資料？")) return;
              setMsg("複製中…");
              try {
                const n = await store.copyFromMain((k) => setMsg(`複製中…（${k}）`));
                setMsg(`已複製 ${n} 筆資料。`);
              } catch (e) {
                setMsg("複製失敗：" + e.message);
              }
            }}
          >
            複製正式資料到預覽版
          </button>
        </section>
      )}

      <section className="card">
        <h3>外觀</h3>
        <div className="seg">
          {[
            ["system", "跟隨系統"],
            ["light", "淺色"],
            ["dark", "深色"],
          ].map(([k, l]) => (
            <button key={k} className={themePref === k ? "on" : ""} onClick={() => setTheme(k)}>
              {l}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>備份</h3>
        <p className="muted sm">免費方案沒有自動備份。建議每隔一段時間匯出一次，備份檔包含所有頁面、白板和圖片。</p>
        <div className="row">
          <button className="btn" onClick={doExport}>
            匯出備份
          </button>
          <button className="btn" onClick={() => fileRef.current.click()}>
            從備份匯入
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => doImport(e.target.files[0])} />
        </div>
      </section>

      <section className="card">
        <h3>安裝到手機主畫面</h3>
        <p className="muted sm">
          Android：用 Chrome 開啟這個網址 → 右上角「⋮」→「加到主畫面」或「安裝應用程式」。之後就能像 App 一樣從桌面開啟。
        </p>
      </section>
      {msg && <p className="ok">{msg}</p>}
    </div>
  );
}

/* ---------------- 搜尋 ---------------- */
let contentCache = null;
function textOf(body) {
  if (!body) return "";
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (typeof v.text === "string") out.push(v.text);
      for (const k in v) if (k !== "props") walk(v[k]);
    }
  };
  try {
    walk(JSON.parse(body));
  } catch {}
  return out.join(" ");
}

function SearchDialog({ ctx, onClose }) {
  const { pages, isGone, byId } = ctx;
  const [q, setQ] = useState("");
  const [texts, setTexts] = useState(contentCache);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    store.getAllContent().then((all) => {
      contentCache = Object.fromEntries(Object.entries(all).map(([id, v]) => [id, textOf(v?.body)]));
      setTexts(contentCache);
    });
  }, []);
  const term = q.trim().toLowerCase();
  const live = pages.filter((p) => !isGone(p));
  let results;
  if (!term) results = live.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 10).map((p) => ({ p }));
  else {
    results = [];
    for (const p of live) {
      const inTitle = titleOf(p).toLowerCase().includes(term);
      const t = texts?.[p.id] || "";
      const i = t.toLowerCase().indexOf(term);
      if (inTitle || i >= 0) results.push({ p, inTitle, snip: i >= 0 ? t.slice(Math.max(0, i - 20), i + 60) : "" });
    }
    results.sort((a, b) => (b.inTitle ? 1 : 0) - (a.inTitle ? 1 : 0) || (b.p.updatedAt || 0) - (a.p.updatedAt || 0));
    results = results.slice(0, 30);
  }
  const open = (p) => {
    go("p/" + p.id);
    onClose();
  };
  return (
    <Modal onClose={onClose} top>
      <input
        className="field big"
        autoFocus
        placeholder="搜尋標題和內容…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, results.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
          if (e.key === "Enter" && results[sel]) open(results[sel].p);
        }}
      />
      {!term && <div className="sub-label">最近</div>}
      <div className="list">
        {results.map(({ p, snip }, i) => (
          <button key={p.id} className={"lrow col" + (i === sel ? " sel" : "")} onClick={() => open(p)} onMouseEnter={() => setSel(i)}>
            <span>
              <span className="pi">{iconOf(p)}</span> {titleOf(p)}
              {p.parentId && byId[p.parentId] && <span className="muted sm"> · {titleOf(byId[p.parentId])}</span>}
            </span>
            {snip && <span className="snip">…{snip}…</span>}
          </button>
        ))}
        {term && results.length === 0 && <p className="muted">{texts ? "找不到符合的頁面" : "讀取內容中…"}</p>}
      </div>
    </Modal>
  );
}

/* ---------------- 共用元件 ---------------- */
function Modal({ children, onClose, title, top }) {
  useEffect(() => {
    const on = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className={"modal" + (top ? " top" : "")} onClick={(e) => e.stopPropagation()}>
        {title && <div className="modal-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button type="button" className={"toggle" + (on ? " on" : "")} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span />
    </button>
  );
}

function SyncDot({ sync }) {
  const state = sync.error ? "err" : !sync.online ? "off" : sync.inflight ? "busy" : "ok";
  const label = { err: "同步發生錯誤", off: "離線中，連線後會自動同步", busy: "同步中…", ok: cloudConfigured ? "已同步" : "本機模式" }[state];
  return (
    <span className={"sync " + state} title={label}>
      <i />
      <span className="sync-l">{label}</span>
    </span>
  );
}

function Splash({ text }) {
  return (
    <div className="splash">
      <div className="brand big">筆記</div>
      <p className="muted">{text}</p>
    </div>
  );
}
function Empty({ text }) {
  return <div className="empty muted">{text}</div>;
}

function Login() {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="splash">
      <div className="brand big">筆記</div>
      <p className="muted">用你的 Google 帳號登入，筆記會在每台裝置同步。</p>
      <button
        className="btn primary big"
        disabled={busy}
        onClick={async () => {
          setErr("");
          setBusy(true);
          try {
            await store.signIn();
          } catch (e) {
            const c = e.code || "";
            setErr(
              c.includes("unauthorized-domain")
                ? "這個網址還沒加進 Firebase 的授權網域（Authentication → Settings → Authorized domains）。"
                : c.includes("popup-blocked")
                  ? "登入視窗被瀏覽器擋住了，請允許彈出視窗後再試一次。"
                  : c.includes("popup-closed") || c.includes("cancelled")
                    ? ""
                    : "登入失敗：" + (e.message || c),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        用 Google 登入
      </button>
      {err && <p className="err-t">{err}</p>}
    </div>
  );
}

const PATHS = {
  menu: "M3 6h18M3 12h18M3 18h18",
  left: "M15 18l-6-6 6-6M20 18l-6-6 6-6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  cal: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
  plus: "M12 5v14M5 12h14",
  board: "M3 5h18v12H3zM8 21l4-4 4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  chev: "M9 6l6 6-6 6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  "star-on": "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
};
function Icon({ name }) {
  return (
    <svg className={"ic ic-" + name} viewBox="0 0 24 24" fill={name === "star-on" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={name === "more" ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
