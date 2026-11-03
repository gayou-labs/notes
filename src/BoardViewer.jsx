// 筆記裡嵌入的白板：唯讀，點一下就能拖曳、縮放瀏覽；雙擊開啟白板頁
import { useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { store } from "./store.js";
import { actions } from "./registry.js";
import { loadScene, renderEmbeddable, validateEmbeddable } from "./Board.jsx";

export default function BoardViewer({ pageId }) {
  const [initial, setInitial] = useState(undefined);
  const [active, setActive] = useState(false);
  const api = useRef(null);
  const box = useRef(null);
  const open = () => (location.hash = "#/p/" + pageId);

  useEffect(() => {
    let first = true;
    return store.subscribeContent(pageId, async (data) => {
      const sc = await loadScene(data);
      if (first) {
        first = false;
        setInitial(sc);
      } else if (api.current) {
        api.current.addFiles(Object.values(sc.files));
        api.current.updateScene({ elements: sc.elements });
      }
    });
  }, [pageId]);

  // 點到別的地方就結束瀏覽，讓筆記頁可以正常捲動
  useEffect(() => {
    if (!active) return;
    const on = (e) => !box.current?.contains(e.target) && setActive(false);
    document.addEventListener("pointerdown", on, true);
    return () => document.removeEventListener("pointerdown", on, true);
  }, [active]);

  // 雙擊（瀏覽中也一樣）→ 開啟白板頁
  useEffect(() => {
    const el = box.current;
    const on = () => open();
    el?.addEventListener("dblclick", on, true);
    return () => el?.removeEventListener("dblclick", on, true);
  });

  const empty = initial && !initial.elements.some((e) => !e.isDeleted);
  return (
    <div className={"bv" + (active ? " active" : "")} ref={box}>
      {initial === undefined ? (
        <div className="be-msg">載入白板中…</div>
      ) : empty ? (
        <div className="be-msg">空白白板，雙擊開始畫</div>
      ) : (
        <Excalidraw
          excalidrawAPI={(a) => (api.current = a)}
          initialData={{ ...initial, scrollToContent: true }}
          viewModeEnabled
          zenModeEnabled
          theme={actions.theme}
          langCode="zh-TW"
          validateEmbeddable={validateEmbeddable}
          renderEmbeddable={renderEmbeddable(true)}
          UIOptions={{ canvasActions: { changeViewBackgroundColor: false, clearCanvas: false, export: false, loadScene: false, saveAsImage: false, saveToActiveFile: false, toggleTheme: false } }}
        />
      )}
      {!active && !empty && initial !== undefined && (
        <div className="bv-cover" onClick={() => setActive(true)} title="點一下可以拖曳、縮放瀏覽；雙擊開啟白板">
          <span className="bv-hint">點一下瀏覽 · 雙擊開啟</span>
        </div>
      )}
      {empty && <div className="bv-cover" title="雙擊開啟白板" />}
    </div>
  );
}
