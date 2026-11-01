# 筆記

個人筆記工具：筆記、白板、製作排程放在同一個地方，電腦和手機即時同步。

- 網站放在 GitHub Pages（這個儲存庫只有程式，沒有任何筆記內容）
- 資料存在自己的 Firebase，只有指定的 Google 帳號能讀寫
- 沒網路時也能使用，連線後自動同步
- 可以安裝到 Android 主畫面

## 結構

| 檔案 | 用途 |
| --- | --- |
| `src/config.js` | Firebase 設定（不是密碼） |
| `src/store.js` | 資料層：本機模式／雲端模式 |
| `src/Editor.jsx` | 筆記編輯器（BlockNote） |
| `src/Board.jsx` | 白板（Excalidraw） |
| `public/schedule.html` | 製作排程（原本的排程表 + 一行橋接） |
| `public/schedule-bridge.js` | 讓排程表改存進 Firebase |

## 更新排程表

原本的排程表改好之後，執行：

```
npm run sync-schedule -- <原本的 schedule.html 路徑>
```

會把它複製到 `public/schedule.html`，只多加一行橋接程式，其餘完全不變。

## 授權

使用了 BlockNote 的分欄套件（GPL-3.0），整個專案以 GPL-3.0 釋出。
