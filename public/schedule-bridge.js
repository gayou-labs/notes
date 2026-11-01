// 排程表 ↔ 筆記工具的橋接：
// 排程表本來就支援 window.claude.use("db") 這種雲端資料庫介面，
// 這裡提供同樣的介面，背後改用筆記工具的 Firebase 資料庫。
(function () {
  var bridge = null;
  try {
    bridge = window.parent !== window && window.parent.__notesBridge;
  } catch (e) {}
  if (!bridge) return; // 單獨開啟時：照原本方式運作

  var KEY = "schedule-main";
  function makeDoc() {
    return {
      set: function (obj) {
        bridge.put(KEY, JSON.stringify(obj));
        return Promise.resolve();
      },
      onSnapshot: function (cb, onErr) {
        return bridge.subscribe(KEY, function (val, meta) {
          if (meta && meta.pending) return; // 自己剛存的，不用再套用一次
          var data = null;
          if (val) {
            try {
              data = typeof val === "string" ? JSON.parse(val) : val;
            } catch (e) {
              onErr && onErr(e);
              return;
            }
          }
          cb({ exists: !!data, data: function () { return data; } });
        });
      },
    };
  }
  var db = { doc: function () { return makeDoc(); } };
  window.claude = {
    use: function (name) {
      return Promise.resolve(name === "db" ? db : null);
    },
  };
})();
