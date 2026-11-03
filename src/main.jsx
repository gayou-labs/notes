import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);

// 排程已移出筆記工具：清掉之前內嵌排程表留在這台裝置瀏覽器裡的副本
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith("prod-schedule")) localStorage.removeItem(k);
  }
  indexedDB.deleteDatabase("prod-schedule-fs");
} catch {}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
