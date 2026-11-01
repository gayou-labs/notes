// 白板（Excalidraw）用的字型：建置時從套件複製到 public/fonts，讓網站自己提供字型
import { cpSync, existsSync } from "node:fs";
const from = new URL("../node_modules/@excalidraw/excalidraw/dist/prod/fonts", import.meta.url);
const to = new URL("../public/fonts", import.meta.url);
if (!existsSync(from)) throw new Error("找不到 Excalidraw 字型，請先執行 npm install");
cpSync(from, to, { recursive: true });
console.log("已複製白板字型");
