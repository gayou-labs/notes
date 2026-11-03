// 讓網頁在沒網路時也能打開（只快取程式本身；筆記資料由 Firebase 的離線快取負責）
// 正式版與預覽版各用自己的快取；改版時換掉名稱，舊快取會被清掉
const CACHE = "notes-shell-v3-" + new URL(self.registration.scope).pathname;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  const mine = (k) => k.endsWith(new URL(self.registration.scope).pathname);
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && (mine(k) || k === "notes-shell-v1")).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Firebase、Google 登入等交給瀏覽器
  const scopePath = new URL(self.registration.scope).pathname;
  if (!scopePath.includes("/preview/") && url.pathname.startsWith(scopePath + "preview/")) return; // 預覽版交給它自己的快取
  const page = req.mode === "navigate" && req.destination === "document"; // 最外層的頁面（不含排程表等內嵌頁）
  const key = page ? new URL("./", self.registration.scope).href : req;

  // 檔名帶版本號的程式檔、字型：內容不會變，用快取最快
  if (/\/(assets|fonts)\//.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
    return;
  }
  // 其他檔案（頁面、排程表、圖示…）：先拿最新的，沒網路才用快取
  e.respondWith(
    fetch(req)
      .then((res) => put(key, res))
      .catch(() => caches.match(key, { ignoreSearch: true })),
  );
});
