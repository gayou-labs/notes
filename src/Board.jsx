import { useEffect, useRef, useState } from "react";
import { Excalidraw, getSceneVersion, restoreElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { store, CLIENT_ID } from "./store.js";

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

function parse(data) {
  if (!data?.body) return null;
  try {
    return JSON.parse(data.body);
  } catch {
    return null;
  }
}

async function loadFiles(ids) {
  const out = {};
  await Promise.all(
    (ids || []).map(async (id) => {
      const f = await store.getFile("board-" + id).catch(() => null);
      if (f) out[id] = { id, dataURL: f.data, mimeType: f.mime, created: f.savedAt || Date.now() };
    }),
  );
  return out;
}

async function loadScene(data) {
  const scene = parse(data);
  if (!scene) return { elements: [], files: {}, appState: {} };
  const files = await loadFiles(scene.fileIds);
  return {
    elements: restoreElements(scene.elements || [], null),
    files,
    appState: { viewBackgroundColor: scene.bg || undefined },
  };
}

function BoardInner({ pageId, initial, theme }) {
  const api = useRef(null);
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
    if (body.length > 950_000) alert("這個白板內容太大，可能無法同步。建議分成兩個白板。");
    store.putContent(pageId, { body, clientId: CLIENT_ID, savedAt: Date.now() }).catch(() => {});
  };

  const onChange = (elements, appState, files) => {
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
    document.addEventListener("visibilitychange", vis);
    return () => {
      flush();
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

  return (
    <div className="board-wrap">
      <Excalidraw
        excalidrawAPI={(a) => (api.current = a)}
        initialData={initial}
        onChange={onChange}
        theme={theme}
        langCode="zh-TW"
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true } } }}
      />
    </div>
  );
}
