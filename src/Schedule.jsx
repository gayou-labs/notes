import { useEffect, useState } from "react";
import { store } from "./store.js";

// 排程：直接嵌入原本的排程表（public/schedule.html），
// 透過 schedule-bridge.js 讓它把資料存進同一個 Firebase 資料庫。
window.__notesBridge = {
  subscribe: (key, cb) => store.subscribeKV(key, cb),
  put: (key, val) => store.putKV(key, val).catch(() => {}),
};

export default function Schedule({ theme }) {
  const [empty, setEmpty] = useState(false);
  useEffect(() => store.subscribeKV("schedule-main", (v) => setEmpty(!v)), []);
  return (
    <div className="sched-wrap">
      {empty && (
        <div className="banner">
          排程還沒有資料。要搬入舊資料：在排程表裡按「設定」→「開啟匯出入」→「匯入」，選擇雲端硬碟裡的「製作排程-同步.json」。
        </div>
      )}
      <iframe key={theme} className="sched-frame" src={`./schedule.html?theme=${theme}`} title="製作排程" />
    </div>
  );
}
