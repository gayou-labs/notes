# 筆記

個人筆記工具：筆記、白板放在同一個地方，電腦和手機即時同步。（製作排程是另一個獨立工具。）

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
| `src/Blocks.jsx` | 頁面連結、嵌入白板、嵌入 HTML |
| `src/Links.jsx` | 反向連結側欄、關聯圖 |

## 預覽版

`preview` 分支會發布到 `/notes/preview/`，使用獨立的測試資料。確認沒問題後再合併到 `main`。

## 授權

使用了 BlockNote 的分欄套件（GPL-3.0），整個專案以 GPL-3.0 釋出。
