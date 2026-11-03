import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Excalidraw, MainMenu, getSceneVersion, restoreElements, useHandleLibrary } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { store, CLIENT_ID } from "./store.js";
import { actions, getPage } from "./registry.js";
import { NoteCard, NotePicker, noteIdOf, noteLink } from "./NoteCard.jsx";

// 物件貼齊：記住自己的選擇（預設開啟）
const snapPref = () => {
  try {
    return localStorage.getItem("notes-board-snap") !== "0";
  } catch {
    return true;
  }
};
const setSnapPref = (v) => {
  try {
    localStorage.setItem("notes-board-snap", v ? "1" : "0");
  } catch {}
};
// 白板裡可以嵌入：筆記頁，以及 Excalidraw 原本支援的網站（YouTube 等）
export const validateEmbeddable = (link) => (noteIdOf(link) ? true : undefined);
export const renderEmbeddable = (readOnly) => (el) => {
  const id = noteIdOf(el.link);
  return id ? <NoteCard pageId={id} readOnly={readOnly} /> : null;
};

// 白板：用開源的 Excalidraw，資料存在同一個資料庫
export default function Board({ pageId, theme }) {
  const [initial, setInitial] = useState(undefined);

  useEffect(() => {
    setInitial(undefined);
    let first = true;
    const unsub = store.subscribeContent(pageId, (data, meta) => {
      if (first) {
        first = false;
        loadScene(data).then(setInitial);
        return;
      }
      window.dispatchEvent(new CustomEvent("remote-board", { detail: { pageId, data, meta } }));
    });
    return unsub;
  }, [pageId]);

  if (initial === undefined) return <div className="loading">載入白板中…</div>;
  return <BoardInner key={pageId} pageId={pageId} initial={initial} theme={theme} />;
}

export function parse(data) {
  if (!data?.body) return null;
  try {
    return JSON.parse(data.body);
  } catch {
    return null;
  }
}

export async function loadFiles(ids) {
  const out = {};
  await Promise.all(
    (ids || []).map(async (id) => {
      const f = await store.getFile("board-" + id).catch(() => null);
      if (f) out[id] = { id, dataURL: f.data, mimeType: f.mime, created: f.savedAt || Date.now() };
    }),
  );
  return out;
}

export async function loadScene(data) {
  const scene = parse(data);
  if (!scene) return { elements: [], files: {}, appState: { objectsSnapModeEnabled: snapPref() } };
  const files = await loadFiles(scene.fileIds);
  return {
    elements: restoreElements(scene.elements || [], null),
    files,
    appState: { viewBackgroundColor: scene.bg || undefined, objectsSnapModeEnabled: snapPref() },
  };
}

// 素材庫（Library）：常用圖形的收藏，所有白板共用，存在同一個資料庫
const LIB_KEY = "board-library";
const libraryAdapter = {
  async load() {
    const raw = await store.getKV(LIB_KEY).catch(() => null);
    if (!raw) return { libraryItems: [] };
    try {
      return { libraryItems: JSON.parse(raw) };
    } catch {
      return { libraryItems: [] };
    }
  },
  async save({ libraryItems }) {
    const json = JSON.stringify(libraryItems);
    if (json.length > 950_000) {
      alert("素材庫太大，無法同步。請刪掉一些不常用的素材。");
      return;
    }
    await store.putKV(LIB_KEY, json).catch(() => {});
  },
};

// 從 Excalidraw 素材網站按「加入」回來時，把素材加進素材庫
async function importPendingLibrary(api) {
  let pending = null;
  try {
    pending = sessionStorage.getItem("pending-library");
    sessionStorage.removeItem("pending-library");
  } catch {}
  if (!pending) return;
  const url = new URLSearchParams(pending.replace(/^#/, "")).get("addLibrary");
  if (!url) return;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {}
  if (!/(^|\.)excalidraw\.com$/.test(host)) return; // 只接受官方素材網站
  try {
    const blob = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.blob();
    });
    await api.updateLibrary({ libraryItems: blob, merge: true, openLibraryMenu: true });
  } catch (e) {
    alert("加入素材失敗，請再試一次。");
  }
}

function BoardInner({ pageId, initial, theme }) {
  const api = useRef(null);
  const [apiState, setApiState] = useState(null);
  useHandleLibrary({ excalidrawAPI: apiState, adapter: libraryAdapter });
  useEffect(() => {
    if (apiState) importPendingLibrary(apiState);
  }, [apiState]);
  useEffect(() => {
    try {
      localStorage.setItem("notes-last-board", pageId);
    } catch {}
  }, [pageId]);
  const lastVersion = useRef(getSceneVersion(initial.elements));
  const savedFiles = useRef(new Set(Object.keys(initial.files)));
  const lastLocalEdit = useRef(0);
  const timer = useRef(null);
  const pending = useRef(null);
  const applyingRemote = useRef(false);

  const save = () => {
    clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    const { elements, appState, files } = p;
    const live = elements.filter((e) => !e.isDeleted);
    const fileIds = [...new Set(live.filter((e) => e.type === "image" && e.fileId).map((e) => e.fileId))];
    for (const id of fileIds) {
      if (savedFiles.current.has(id) || !files[id]) continue;
      const f = files[id];
      if (f.dataURL.length > 1_000_000) {
        alert("這張圖片太大，無法存到白板（上限約 700KB）。建議先縮小再貼上。");
        continue;
      }
      savedFiles.current.add(id);
      store.putFile("board-" + id, { data: f.dataURL, mime: f.mimeType, savedAt: Date.now() }).catch(() => {});
    }
    const body = JSON.stringify({ elements: live, fileIds, bg: appState.viewBackgroundColor });
    // 白板裡放了哪些筆記頁（給反向連結、關聯圖用）
    const links = [...new Set(live.map((e) => e.type === "embeddable" && noteIdOf(e.link)).filter(Boolean))].sort();
    if (links.join() !== (getPage(pageId)?.links || []).join()) actions.updatePage(pageId, { links });
    if (body.length > 950_000) alert("這個白板內容太大，可能無法同步。建議分成兩個白板。");
    store.putContent(pageId, { body, clientId: CLIENT_ID, savedAt: Date.now() }).catch(() => {});
  };

  const [snap, setSnap] = useState(snapPref());
  const [picking, setPicking] = useState(false);
  const onChange = (elements, appState, files) => {
    if (appState.objectsSnapModeEnabled !== snap) {
      setSnap(appState.objectsSnapModeEnabled);
      setSnapPref(appState.objectsSnapModeEnabled);
    }
    if (applyingRemote.current) return;
    const v = getSceneVersion(elements);
    if (v === lastVersion.current) return; // 只是移動畫面，沒有改內容
    lastVersion.current = v;
    lastLocalEdit.current = Date.now();
    pending.current = { elements, appState, files };
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 1000);
  };

  useEffect(() => {
    const flush = () => pending.current && save();
    const vis = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    window.addEventListener("flush-now", flush);
    document.addEventListener("visibilitychange", vis);
    return () => {
      flush();
      window.removeEventListener("flush-now", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 其他裝置的變更
  useEffect(() => {
    const onRemote = async (e) => {
      const { pageId: pid, data, meta } = e.detail;
      if (pid !== pageId || meta?.pending || !data || data.clientId === CLIENT_ID) return;
      if (pending.current || Date.now() - lastLocalEdit.current < 2000) return;
      const scene = parse(data);
      if (!scene || !api.current) return;
      const missing = (scene.fileIds || []).filter((id) => !api.current.getFiles()[id]);
      if (missing.length) {
        const files = await loadFiles(missing);
        api.current.addFiles(Object.values(files));
        missing.forEach((id) => savedFiles.current.add(id));
      }
      const elements = restoreElements(scene.elements || [], null);
      applyingRemote.current = true;
      api.current.updateScene({ elements });
      lastVersion.current = getSceneVersion(elements);
      setTimeout(() => (applyingRemote.current = false), 50);
    };
    window.addEventListener("remote-board", onRemote);
    return () => window.removeEventListener("remote-board", onRemote);
  }, [pageId]);

  const insertNote = (id) => {
    setPicking(false);
    const a = api.current;
    if (!a) return;
    const st = a.getAppState();
    const z = st.zoom?.value || 1;
    const w = 420,
      h = 340;
    const [el] = restoreElements(
      [
        {
          type: "embeddable",
          id: "note-" + Math.random().toString(36).slice(2, 10),
          x: -st.scrollX + st.width / 2 / z - w / 2,
          y: -st.scrollY + st.height / 2 / z - h / 2,
          width: w,
          height: h,
          link: noteLink(id),
          strokeColor: "transparent",
          backgroundColor: "transparent",
          roundness: { type: 3 },
        },
      ],
      null,
    );
    a.updateScene({ elements: [...a.getSceneElementsIncludingDeleted(), el] });
    a.setActiveTool({ type: "selection" });
  };

  return (
    <div className="board-wrap">
      <Excalidraw
        excalidrawAPI={(a) => {
          api.current = a;
          setApiState(a);
        }}
        libraryReturnUrl={location.origin + location.pathname}
        validateEmbeddable={validateEmbeddable}
        renderEmbeddable={renderEmbeddable(false)}
        renderTopRightUI={() => (
          <div className="bd-tools">
            <button className="bd-btn" onClick={() => setPicking(true)} title="把筆記頁放進白板，可以直接編輯">
              📄 嵌入筆記
            </button>
            <label className="bd-btn ck" title="拖動物件時自動對齊其他物件（Alt+S）">
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => {
                  setSnap(e.target.checked);
                  setSnapPref(e.target.checked);
                  api.current?.updateScene({ appState: { objectsSnapModeEnabled: e.target.checked } });
                }}
              />
              物件貼齊
            </label>
          </div>
        )}
        initialData={initial}
        onChange={onChange}
        theme={theme}
        langCode="zh-TW"
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true } } }}
      >
        {/* 自訂選單：只留實用功能，拿掉 Excalidraw 的社群連結 */}
        <MainMenu>
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
      {picking && createPortal(<NotePicker boardId={pageId} onPick={insertNote} onClose={() => setPicking(false)} />, document.body)}
    </div>
  );
}
