// 資料層：同一套介面，兩種後端
//  - 本機模式：資料存在這台裝置的瀏覽器（IndexedDB），用來試用
//  - 雲端模式：Firebase（Firestore），多裝置即時同步，離線也能用
import { firebaseConfig } from "./config.js";

export const CLIENT_ID = Math.random().toString(36).slice(2, 10);
export const uid16 = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join("");

/* ---------- 同步狀態（給畫面顯示） ---------- */
const statusListeners = new Set();
let inflight = 0;
let lastError = null;
export function onSyncStatus(cb) {
  statusListeners.add(cb);
  cb(syncStatus());
  return () => statusListeners.delete(cb);
}
function syncStatus() {
  return { inflight, online: navigator.onLine, error: lastError };
}
function emitStatus() {
  const s = syncStatus();
  statusListeners.forEach((cb) => cb(s));
}
window.addEventListener("online", emitStatus);
window.addEventListener("offline", emitStatus);
function track(p) {
  inflight++;
  emitStatus();
  return p
    .then((v) => {
      lastError = null;
      return v;
    })
    .catch((e) => {
      lastError = e?.message || String(e);
      console.error(e);
      throw e;
    })
    .finally(() => {
      inflight--;
      emitStatus();
    });
}

/* ---------- 本機模式：簡單的 IndexedDB 鍵值庫 ---------- */
function idb() {
  if (!idb.p) {
    idb.p = new Promise((res, rej) => {
      const r = indexedDB.open("notes-local", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return idb.p;
}
async function idbAll() {
  const db = await idb();
  return new Promise((res, rej) => {
    const out = {};
    const tx = db.transaction("kv").objectStore("kv").openCursor();
    tx.onsuccess = () => {
      const c = tx.result;
      if (c) {
        out[c.key] = c.value;
        c.continue();
      } else res(out);
    };
    tx.onerror = () => rej(tx.error);
  });
}
async function idbSet(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readwrite");
    if (val === undefined) tx.objectStore("kv").delete(key);
    else tx.objectStore("kv").put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

function createLocalBackend() {
  const data = { pages: {}, content: {}, files: {}, kv: {} };
  const subs = { pages: new Set(), content: new Map(), kv: new Map() };
  let ready;

  const load = async () => {
    const all = await idbAll();
    for (const [k, v] of Object.entries(all)) {
      const [col, ...rest] = k.split(":");
      if (data[col]) data[col][rest.join(":")] = v;
    }
  };
  const persist = (col, id, val) => idbSet(`${col}:${id}`, val);
  const emitPages = () => {
    const list = Object.values(data.pages);
    subs.pages.forEach((cb) => cb(list));
  };
  const emitDoc = (map, col, id) => (map.get(id) || new Set()).forEach((cb) => cb(data[col][id] ?? null));

  return {
    mode: "local",
    async init(onUser) {
      ready = load();
      await ready;
      onUser({ uid: "local", name: "本機", email: "" });
    },
    async signIn() {},
    async signOut() {},
    subscribePages(cb) {
      subs.pages.add(cb);
      ready.then(() => cb(Object.values(data.pages)));
      return () => subs.pages.delete(cb);
    },
    putPage(meta) {
      data.pages[meta.id] = { ...(data.pages[meta.id] || {}), ...meta };
      emitPages();
      return track(persist("pages", meta.id, data.pages[meta.id]));
    },
    async removePage(id) {
      delete data.pages[id];
      delete data.content[id];
      emitPages();
      await track(Promise.all([persist("pages", id), persist("content", id)]));
    },
    subscribeContent(id, cb) {
      if (!subs.content.has(id)) subs.content.set(id, new Set());
      subs.content.get(id).add(cb);
      ready.then(() => cb(data.content[id] ?? null));
      return () => subs.content.get(id)?.delete(cb);
    },
    putContent(id, val) {
      data.content[id] = val;
      return track(persist("content", id, val));
    },
    async getContent(id) {
      await ready;
      return data.content[id] ?? null;
    },
    async getAllContent() {
      await ready;
      return { ...data.content };
    },
    putFile(id, val) {
      data.files[id] = val;
      return track(persist("files", id, val));
    },
    async getFile(id) {
      await ready;
      return data.files[id] ?? null;
    },
    async getAllFiles() {
      await ready;
      return { ...data.files };
    },
    subscribeKV(key, cb) {
      if (!subs.kv.has(key)) subs.kv.set(key, new Set());
      subs.kv.get(key).add(cb);
      ready.then(() => cb(data.kv[key] ?? null));
      return () => subs.kv.get(key)?.delete(cb);
    },
    putKV(key, val) {
      data.kv[key] = val;
      emitDoc(subs.kv, "kv", key);
      return track(persist("kv", key, val));
    },
    async getKV(key) {
      await ready;
      return data.kv[key] ?? null;
    },
    async getAllKV() {
      await ready;
      return { ...data.kv };
    },
  };
}

/* ---------- 雲端模式：Firebase ---------- */
async function createFirebaseBackend() {
  const { initializeApp } = await import("firebase/app");
  const A = await import("firebase/auth");
  const F = await import("firebase/firestore");

  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn("離線快取無法啟用，改用一般模式", e);
    db = F.getFirestore(app);
  }
  let uid = null;
  const col = (name) => F.collection(db, "users", uid, name);
  const ref = (name, id) => F.doc(db, "users", uid, name, id);
  // Firestore 的文件 ID 不能有斜線
  const safe = (id) => String(id).replace(/\//g, "_");

  const docsToMap = async (name) => {
    const snap = await F.getDocs(col(name));
    const out = {};
    snap.forEach((d) => (out[d.id] = d.data()));
    return out;
  };

  return {
    mode: "cloud",
    init(onUser) {
      A.onAuthStateChanged(auth, (u) => {
        uid = u ? u.uid : null;
        onUser(u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL } : null);
      });
    },
    async signIn() {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await A.signInWithPopup(auth, provider);
    },
    async signOut() {
      await A.signOut(auth);
    },
    subscribePages(cb) {
      return F.onSnapshot(
        col("pages"),
        (snap) => cb(snap.docs.map((d) => d.data())),
        (e) => {
          lastError = e.message;
          emitStatus();
        },
      );
    },
    putPage(meta) {
      return track(F.setDoc(ref("pages", meta.id), meta, { merge: true }));
    },
    async removePage(id) {
      await track(Promise.all([F.deleteDoc(ref("pages", id)), F.deleteDoc(ref("content", id))]));
    },
    subscribeContent(id, cb) {
      return F.onSnapshot(
        ref("content", id),
        (snap) => cb(snap.exists() ? snap.data() : null, { pending: snap.metadata.hasPendingWrites }),
        (e) => {
          lastError = e.message;
          emitStatus();
        },
      );
    },
    putContent(id, val) {
      return track(F.setDoc(ref("content", id), val));
    },
    async getContent(id) {
      const s = await F.getDoc(ref("content", id));
      return s.exists() ? s.data() : null;
    },
    getAllContent: () => docsToMap("content"),
    putFile(id, val) {
      return track(F.setDoc(ref("files", safe(id)), val));
    },
    async getFile(id) {
      const s = await F.getDoc(ref("files", safe(id)));
      return s.exists() ? s.data() : null;
    },
    getAllFiles: () => docsToMap("files"),
    subscribeKV(key, cb) {
      return F.onSnapshot(ref("kv", safe(key)), (snap) =>
        cb(snap.exists() ? snap.data().value : null, { pending: snap.metadata.hasPendingWrites }),
      );
    },
    putKV(key, val) {
      return track(F.setDoc(ref("kv", safe(key)), { value: val, savedAt: Date.now() }));
    },
    async getKV(key) {
      const s = await F.getDoc(ref("kv", safe(key)));
      return s.exists() ? s.data().value : null;
    },
    async getAllKV() {
      const m = await docsToMap("kv");
      return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.value]));
    },
  };
}

export const cloudConfigured = !!(firebaseConfig && firebaseConfig.apiKey);
export const store = cloudConfigured ? await createFirebaseBackend() : createLocalBackend();

/* ---------- 備份：匯出 / 匯入 ---------- */
export async function exportAll(pages) {
  const [content, files, kv] = await Promise.all([store.getAllContent(), store.getAllFiles(), store.getAllKV()]);
  return { app: "notes", version: 1, exportedAt: new Date().toISOString(), pages, content, files, kv };
}
export async function importAll(obj) {
  if (!obj || obj.app !== "notes") throw new Error("這不是筆記工具的備份檔");
  for (const p of obj.pages || []) await store.putPage(p);
  for (const [id, v] of Object.entries(obj.content || {})) await store.putContent(id, v);
  for (const [id, v] of Object.entries(obj.files || {})) await store.putFile(id, v);
  for (const [k, v] of Object.entries(obj.kv || {})) await store.putKV(k, v);
}

/* ---------- 圖片：壓縮後存進資料庫（不需要付費的檔案儲存） ---------- */
const MAX_BYTES = 700 * 1024; // Firestore 單筆上限 1 MiB，base64 會變大約 1.33 倍
export async function compressImage(file) {
  if (file.type === "image/gif" || file.type === "image/svg+xml") {
    if (file.size > MAX_BYTES) throw new Error("GIF/SVG 圖片太大（上限約 700KB）");
    return { data: await blobToDataURL(file), mime: file.type };
  }
  const img = await createImageBitmap(file);
  let maxSide = 1800;
  let quality = 0.85;
  for (let i = 0; i < 8; i++) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/webp", quality));
    if (blob && blob.size <= MAX_BYTES) return { data: await blobToDataURL(blob), mime: "image/webp", w: c.width, h: c.height };
    if (quality > 0.6) quality -= 0.1;
    else maxSide = Math.round(maxSide * 0.8);
  }
  throw new Error("圖片壓縮後仍然太大");
}
export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
const fileCache = new Map();
export async function resolveFile(url) {
  if (!url?.startsWith("nf://")) return url;
  const id = url.slice(5);
  if (!fileCache.has(id)) {
    fileCache.set(
      id,
      store.getFile(id).then((f) => {
        if (!f) throw new Error("找不到圖片");
        return f.data;
      }),
    );
  }
  try {
    return await fileCache.get(id);
  } catch (e) {
    fileCache.delete(id);
    return "";
  }
}
export async function uploadImage(file) {
  const id = "img-" + uid16();
  const val = await compressImage(file);
  fileCache.set(id, Promise.resolve(val.data));
  store.putFile(id, { ...val, name: file.name, savedAt: Date.now() }).catch(() => {});
  return "nf://" + id;
}

/* ---------- 雲端模式下，把之前本機試用的資料搬上去 ---------- */
export async function readLocalData() {
  try {
    const all = await idbAll();
    const out = { app: "notes", pages: [], content: {}, files: {}, kv: {} };
    for (const [k, v] of Object.entries(all)) {
      const [col, ...rest] = k.split(":");
      const id = rest.join(":");
      if (col === "pages") out.pages.push(v);
      else if (out[col]) out[col][id] = v;
    }
    return out;
  } catch {
    return null;
  }
}
export async function clearLocalData() {
  const db = await idb();
  await new Promise((res) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").clear();
    tx.oncomplete = res;
  });
}
