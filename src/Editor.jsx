import { useEffect, useRef, useState } from "react";
import { BlockNoteSchema, combineByGroup, filterSuggestionItems } from "@blocknote/core";
import * as locales from "@blocknote/core/locales";
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { withMultiColumn, multiColumnDropCursor, getMultiColumnSlashMenuItems } from "@blocknote/xl-multi-column";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { store, CLIENT_ID, uploadImage, resolveFile } from "./store.js";

const schema = withMultiColumn(BlockNoteSchema.create());
const g = "基本區塊";
const dictionary = {
  ...locales.zhTW,
  placeholders: { ...locales.zhTW.placeholders, default: "輸入文字，或按「/」插入標題、清單、圖片、分欄…" },
  multi_column: {
    slash_menu: {
      two_columns: { title: "兩欄", subtext: "左右兩欄並排", aliases: ["欄", "分欄", "columns", "lan"], group: g },
      three_columns: { title: "三欄", subtext: "三欄並排", aliases: ["欄", "分欄", "columns"], group: g },
    },
  },
};

async function uploadFile(file) {
  if (!file.type.startsWith("image/")) {
    alert("目前只能放圖片。PDF、影片等大檔案建議放 Google 雲端，再把連結貼進筆記。");
    throw new Error("unsupported");
  }
  try {
    return await uploadImage(file);
  } catch (e) {
    alert(e.message);
    throw e;
  }
}

/** 先讀到內容再建立編輯器（避免空白閃一下又被覆蓋） */
export default function Editor({ pageId, theme, onTextChange }) {
  const [initial, setInitial] = useState(undefined);
  const latest = useRef(null);

  useEffect(() => {
    setInitial(undefined);
    let first = true;
    const unsub = store.subscribeContent(pageId, (data, meta) => {
      latest.current = { data, meta };
      if (first) {
        first = false;
        setInitial(parse(data));
      }
      // 之後的遠端變更交給 EditorInner 處理
      window.dispatchEvent(new CustomEvent("remote-content", { detail: { pageId, data, meta } }));
    });
    return unsub;
  }, [pageId]);

  if (initial === undefined) return <div className="loading">載入中…</div>;
  return <EditorInner key={pageId} pageId={pageId} initial={initial} theme={theme} onTextChange={onTextChange} />;
}

function parse(data) {
  if (!data?.body) return null;
  try {
    const b = JSON.parse(data.body);
    return Array.isArray(b) && b.length ? b : null;
  } catch {
    return null;
  }
}

function EditorInner({ pageId, initial, theme, onTextChange }) {
  const editor = useCreateBlockNote({
    schema,
    dictionary,
    dropCursor: multiColumnDropCursor,
    initialContent: initial || undefined,
    uploadFile,
    resolveFileUrl: resolveFile,
    tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
  });

  const dirty = useRef(false);
  const lastLocalEdit = useRef(0);
  const lastSavedBody = useRef(initial ? JSON.stringify(initial) : "");
  const timer = useRef(null);

  const save = () => {
    clearTimeout(timer.current);
    timer.current = null;
    const body = JSON.stringify(editor.document);
    dirty.current = false;
    if (body === lastSavedBody.current) return;
    lastSavedBody.current = body;
    if (body.length > 950_000) alert("這一頁內容太大，可能無法同步。建議把內容拆成幾個子頁面。");
    store.putContent(pageId, { body, clientId: CLIENT_ID, savedAt: Date.now() }).catch(() => {});
    onTextChange?.(pageId);
  };

  const applyingRemote = useRef(false);
  const onChange = () => {
    if (applyingRemote.current) {
      lastSavedBody.current = JSON.stringify(editor.document);
      return;
    }
    dirty.current = true;
    lastLocalEdit.current = Date.now();
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 700);
  };

  // 離開頁面、切到背景時立刻存
  useEffect(() => {
    const flush = () => dirty.current && save();
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

  // 其他裝置改了這一頁 → 套用（自己正在打字時先不覆蓋）
  useEffect(() => {
    const onRemote = (e) => {
      const { pageId: pid, data, meta } = e.detail;
      if (pid !== pageId || !data?.body || meta?.pending) return;
      if (data.clientId === CLIENT_ID) return;
      if (data.body === lastSavedBody.current) return;
      if (dirty.current || Date.now() - lastLocalEdit.current < 1500) return;
      const blocks = parse(data);
      if (!blocks) return;
      lastSavedBody.current = data.body;
      applyingRemote.current = true;
      try {
        editor.replaceBlocks(editor.document, blocks);
      } finally {
        setTimeout(() => (applyingRemote.current = false), 0);
      }
    };
    window.addEventListener("remote-content", onRemote);
    return () => window.removeEventListener("remote-content", onRemote);
  }, [editor, pageId]);

  return (
    <BlockNoteView editor={editor} theme={theme} onChange={onChange} slashMenu={false}>
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems(
            combineByGroup(getDefaultReactSlashMenuItems(editor), getMultiColumnSlashMenuItems(editor)),
            query,
          )
        }
      />
    </BlockNoteView>
  );
}
