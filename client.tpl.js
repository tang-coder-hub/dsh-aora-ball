// dsh-aora-ball — client (web)
//
// 把 Emotion Ball（sam70361/aora-bot 的 emotion-ball 引擎）挂到 DSH 界面右下角。
// 引擎四个文件（rings/emotions/ball/engine）已内联，各自 IIFE 包裹、只通过 window 通信，
// 因此本插件零网络依赖、零构建、不受宿主 CSP 的外链限制。
//
// 状态来源：轮询 http://127.0.0.1:8778/state（由 host 侧 index.js 推送）。
// 服务缺席时球安静地待机，不影响 DSH 任何功能。
//
// 设置面板：注册到 设置 → 内置插件 → 表情球（settings.plugins.tab）。
// 所有设置存 localStorage，改动即时生效，不需要重启。
window.__ModuleLoader__.load({
  id: "dsh-aora-ball",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");

    /*__ENGINE__*/

    var HOST = "http://127.0.0.1:8778";
    var BASE = 148;
    var POLL = 700;
    var SET_KEY = "aora-ball:settings";
    var SET_EVENT = "aora-ball:settings";
    var EMO_EVENT = "aora-ball:emotion";
    var LEGACY_HIDDEN = "aora-ball:hidden";

    var DEFAULTS = {
      hidden: false,
      size: 148,
      corner: "br",
      margin: 18,
      follow: true,
      showTip: true,
    };

    var CORNERS = [
      { id: "br", label: "右下" },
      { id: "bl", label: "左下" },
      { id: "tr", label: "右上" },
      { id: "tl", label: "左上" },
    ];

    var PRESETS = [
      { id: "02", label: "待机" },
      { id: "30", label: "思考" },
      { id: "31", label: "接收" },
      { id: "32", label: "处理" },
      { id: "33", label: "完成" },
      { id: "34", label: "出错" },
      { id: "35", label: "等待" },
      { id: "00", label: "睡眠" },
    ];

    function log() {
      try {
        // eslint-disable-next-line no-console
        console.debug.apply(console, ["[aora-ball]"].concat([].slice.call(arguments)));
      } catch (e) {}
    }

    function clampNum(v, lo, hi, dflt) {
      var n = Number(v);
      if (!isFinite(n)) n = dflt;
      return Math.max(lo, Math.min(hi, n));
    }

    function readSettings() {
      var s = {};
      var k;
      for (k in DEFAULTS) s[k] = DEFAULTS[k];
      var raw = null;
      try {
        raw = localStorage.getItem(SET_KEY);
      } catch (e) {}
      if (raw) {
        try {
          var o = JSON.parse(raw);
          for (k in DEFAULTS) {
            if (o && o[k] !== undefined && o[k] !== null) s[k] = o[k];
          }
        } catch (e2) {}
      } else {
        try {
          var legacy = localStorage.getItem(LEGACY_HIDDEN);
          if (legacy !== null) s.hidden = legacy === "1";
        } catch (e3) {}
      }
      s.size = clampNum(s.size, 80, 280, BASE);
      s.margin = clampNum(s.margin, 0, 80, 18);
      if (["br", "bl", "tr", "tl"].indexOf(s.corner) < 0) s.corner = "br";
      s.hidden = !!s.hidden;
      s.follow = s.follow !== false;
      s.showTip = s.showTip !== false;
      return s;
    }

    function writeSettings(patch) {
      var s = readSettings();
      var k;
      if (patch) {
        for (k in patch) s[k] = patch[k];
      }
      s = (function (x) {
        x.size = clampNum(x.size, 80, 280, BASE);
        x.margin = clampNum(x.margin, 0, 80, 18);
        if (["br", "bl", "tr", "tl"].indexOf(x.corner) < 0) x.corner = "br";
        x.hidden = !!x.hidden;
        x.follow = x.follow !== false;
        x.showTip = x.showTip !== false;
        return x;
      })(s);
      try {
        localStorage.setItem(SET_KEY, JSON.stringify(s));
      } catch (e) {}
      try {
        window.dispatchEvent(new CustomEvent(SET_EVENT, { detail: s }));
      } catch (e2) {}
      return s;
    }

    function pushEmotion(emotionId, tips) {
      try {
        window.dispatchEvent(
          new CustomEvent(EMO_EVENT, { detail: { emotionId: String(emotionId), tips: tips || "" } })
        );
      } catch (e) {}
    }

    // ── 球本体 ──────────────────────────────────────────────
    function mount() {
      if (document.getElementById("aora-ball-root")) return null;
      if (!window.EmotionBall || typeof window.EmotionBall.create !== "function") {
        log("engine missing, skip mount");
        return null;
      }

      var cfg = readSettings();

      var root = document.createElement("div");
      root.id = "aora-ball-root";
      root.style.cssText =
        "position:fixed;width:" + BASE + "px;height:" + BASE + "px;" +
        "z-index:2147483000;pointer-events:none;transition:opacity .25s ease;opacity:1";

      var stage = document.createElement("div");
      stage.style.cssText = "width:100%;height:100%;pointer-events:auto;";
      root.appendChild(stage);

      var tip = document.createElement("div");
      tip.style.cssText =
        "position:absolute;left:0;right:0;bottom:100%;margin-bottom:2px;text-align:center;" +
        "font:11px/15px system-ui,'Microsoft YaHei',sans-serif;color:#8b93a1;" +
        "letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
        "opacity:0;transition:opacity .2s ease;pointer-events:none;user-select:none";
      root.appendChild(tip);

      document.body.appendChild(root);

      var ball = window.EmotionBall.create(stage, {
        emotion: "02",
        idle: true,
        shape: "blob",
      });

      var tipTimer = null;
      ball.on("tips", function (e) {
        var text = (e && e.text) || "";
        if (!cfg.showTip) {
          tip.style.opacity = "0";
          return;
        }
        tip.textContent = text;
        tip.style.opacity = text ? "1" : "0";
        if (tipTimer) clearTimeout(tipTimer);
        if (text) {
          tipTimer = setTimeout(function () {
            tip.style.opacity = "0";
          }, 4000);
        }
      });

      // ── 布局：尺寸用 scale，位置按四角 + 边距
      function applyHidden(hidden) {
        root.style.opacity = hidden ? "0" : "1";
        root.style.pointerEvents = "none";
        stage.style.pointerEvents = hidden ? "none" : "auto";
      }

      function layout(c) {
        var m = c.margin + "px";
        root.style.width = BASE + "px";
        root.style.height = BASE + "px";
        root.style.transform = "scale(" + (c.size / BASE) + ")";
        root.style.right = "auto";
        root.style.bottom = "auto";
        root.style.left = "auto";
        root.style.top = "auto";
        if (c.corner === "br") {
          root.style.right = m;
          root.style.bottom = m;
          root.style.transformOrigin = "100% 100%";
        } else if (c.corner === "bl") {
          root.style.left = m;
          root.style.bottom = m;
          root.style.transformOrigin = "0% 100%";
        } else if (c.corner === "tr") {
          root.style.right = m;
          root.style.top = m;
          root.style.transformOrigin = "100% 0%";
        } else {
          root.style.left = m;
          root.style.top = m;
          root.style.transformOrigin = "0% 0%";
        }
        tip.style.display = c.showTip ? "" : "none";
        applyHidden(c.hidden);
      }

      layout(cfg);

      // ── 鼠标注视：球心为原点把指针位置归一化到 [-1,1]
      function gaze(ev) {
        var r = stage.getBoundingClientRect();
        if (r.width < 1) return;
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height / 2;
        var nx = Math.max(-1, Math.min(1, (ev.clientX - cx) / (r.width * 1.6)));
        var ny = Math.max(-1, Math.min(1, (ev.clientY - cy) / (r.height * 1.6)));
        ball.setGaze(nx, ny);
      }
      window.addEventListener("pointermove", gaze, { passive: true });

      // ── 状态轮询
      var lastKey = "";
      var alive = true;
      function apply(state) {
        if (!cfg.follow) return;
        if (!state || !state.emotionId) return;
        var key = String(state.emotionId) + "|" + (state.tips || "");
        if (key === lastKey) return;
        lastKey = key;
        ball.handleAIMessage({ emotionId: String(state.emotionId), tips: state.tips || "" });
      }
      function poll() {
        if (!alive || document.hidden) return;
        fetch(HOST + "/state", { cache: "no-store" })
          .then(function (r) {
            return r.json();
          })
          .then(apply)
          .catch(function () {});
      }
      var timer = setInterval(poll, POLL);
      poll();

      // ── 显隐快捷：双击 / Alt+B
      function toggle() {
        writeSettings({ hidden: !readSettings().hidden });
      }
      root.addEventListener("dblclick", toggle);
      function onKey(ev) {
        if (ev.altKey && (ev.key === "b" || ev.key === "B")) {
          ev.preventDefault();
          toggle();
        }
      }
      window.addEventListener("keydown", onKey);

      // ── 设置变更实时生效
      function onSettings(ev) {
        cfg = (ev && ev.detail) || readSettings();
        if (cfg.follow) lastKey = "";
        layout(cfg);
      }
      window.addEventListener(SET_EVENT, onSettings);

      function onEmotion(ev) {
        var d = (ev && ev.detail) || {};
        ball.handleAIMessage({ emotionId: String(d.emotionId || "02"), tips: d.tips || "" });
      }
      window.addEventListener(EMO_EVENT, onEmotion);

      log("mounted", cfg.size + "px", cfg.corner);

      return {
        dispose: function () {
          alive = false;
          clearInterval(timer);
          if (tipTimer) clearTimeout(tipTimer);
          window.removeEventListener("pointermove", gaze);
          window.removeEventListener("keydown", onKey);
          window.removeEventListener(SET_EVENT, onSettings);
          window.removeEventListener(EMO_EVENT, onEmotion);
          try {
            ball.destroy();
          } catch (e) {}
          try {
            root.remove();
          } catch (e2) {}
        },
        ball: ball,
      };
    }

    // ── 设置面板（设置 → 内置插件 → 表情球）────────────────
    function AoraSettingsPanel() {
      var h = react.createElement;
      var cfgState = react.useState(readSettings());
      var cfg = cfgState[0];
      var setCfg = cfgState[1];

      var svcState = react.useState({ ok: null, state: null });
      var svc = svcState[0];
      var setSvc = svcState[1];

      react.useEffect(function () {
        var alive = true;
        function tick() {
          fetch(HOST + "/state", { cache: "no-store" })
            .then(function (r) {
              return r.json();
            })
            .then(function (j) {
              if (alive) setSvc({ ok: true, state: j });
            })
            .catch(function () {
              if (alive) setSvc({ ok: false, state: null });
            });
        }
        tick();
        var id = setInterval(tick, 1500);
        return function () {
          alive = false;
          clearInterval(id);
        };
      }, []);

      function save(patch) {
        setCfg(writeSettings(patch));
      }

      var wrap = { fontSize: "13px", lineHeight: "1.5", maxWidth: "560px" };
      var row = {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "8px 0",
      };
      var subStyle = { fontSize: "11px", opacity: 0.55, marginTop: "2px" };
      var btnStyle = {
        font: "inherit",
        fontSize: "12px",
        padding: "3px 10px",
        borderRadius: "6px",
        border: "1px solid rgba(127,127,127,.45)",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
      };
      var sep = { height: "1px", background: "rgba(127,127,127,.22)", margin: "10px 0" };
      var hint = { fontSize: "11px", opacity: 0.55, marginTop: "6px" };

      var cornerSel = h(
        "select",
        {
          value: cfg.corner,
          onChange: function (e) {
            save({ corner: e.target.value });
          },
          style: {
            font: "inherit",
            fontSize: "12px",
            padding: "3px 6px",
            borderRadius: "6px",
            border: "1px solid rgba(127,127,127,.45)",
            background: "transparent",
            color: "inherit",
          },
        },
        CORNERS.map(function (c) {
          return h("option", { key: c.id, value: c.id }, c.label);
        })
      );

      var sizeRow = h(
        "div",
        { style: row },
        h(
          "div",
          null,
          h("div", null, "球的尺寸"),
          h("div", { style: subStyle }, "缩放整体（含眼睛/环带），80–280px")
        ),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          h("input", {
            type: "range",
            min: 80,
            max: 280,
            step: 4,
            value: cfg.size,
            onChange: function (e) {
              save({ size: Number(e.target.value) });
            },
            style: { width: "150px" },
          }),
          h("span", { style: { minWidth: "46px", textAlign: "right" } }, cfg.size + "px")
        )
      );

      var marginRow = h(
        "div",
        { style: row },
        h(
          "div",
          null,
          h("div", null, "距屏幕边缘"),
          h("div", { style: subStyle }, "贴着哪个角，就离那个角多远")
        ),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          h("input", {
            type: "range",
            min: 0,
            max: 80,
            step: 2,
            value: cfg.margin,
            onChange: function (e) {
              save({ margin: Number(e.target.value) });
            },
            style: { width: "150px" },
          }),
          h("span", { style: { minWidth: "46px", textAlign: "right" } }, cfg.margin + "px")
        )
      );

      var cornerRow = h(
        "div",
        { style: row },
        h("div", null, "停在哪个角"),
        cornerSel
      );

      var toggleRow = function (label, desc, value, onToggle) {
        return h(
          "div",
          { style: row },
          h("div", null, h("div", null, label), desc ? h("div", { style: subStyle }, desc) : null),
          h("input", {
            type: "checkbox",
            checked: !!value,
            onChange: function (e) {
              onToggle(e.target.checked);
            },
            style: { width: "16px", height: "16px", cursor: "pointer" },
          })
        );
      };

      var presetRow = h(
        "div",
        { style: { padding: "4px 0 8px" } },
        h("div", null, "试表情"),
        h("div", { style: subStyle }, "点一下球立刻变，不写回设置"),
        h(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" } },
          PRESETS.map(function (p) {
            return h(
              "button",
              {
                key: p.id,
                type: "button",
                style: btnStyle,
                onClick: function () {
                  pushEmotion(p.id, p.label);
                },
              },
              p.label
            );
          })
        )
      );

      var statusText;
      if (svc.ok === null) statusText = "检查中…";
      else if (!svc.ok) statusText = "连不上 127.0.0.1:8778（球会停在待机，不影响 DSH）";
      else {
        var s = svc.state || {};
        statusText =
          "在线 · 当前 " + (s.emotionId || "?") + (s.tips ? " · " + s.tips : "") +
          (typeof s.ageMs === "number" ? " · " + s.ageMs + "ms 前" : "");
      }

      var statusRow = h(
        "div",
        { style: row },
        h("div", null, h("div", null, "状态服务"), h("div", { style: subStyle }, statusText)),
        h(
          "button",
          {
            type: "button",
            style: btnStyle,
            onClick: function () {
              save(pushEmotion("02", "") || {});
              setSvc({ ok: null, state: null });
            },
          },
          "重置表情"
        )
      );

      return h(
        "div",
        { style: wrap },
        toggleRow("显示表情球", "关掉后界面上不出现，随时可从 ⌥/Alt+B 或这里打开", !cfg.hidden, function (v) {
          save({ hidden: !v });
        }),
        sizeRow,
        cornerRow,
        marginRow,
        h("div", { style: sep }),
        toggleRow("跟随会话状态", "思考 / 调工具 / 出错 / 完成 自动换表情", cfg.follow, function (v) {
          save({ follow: v });
        }),
        toggleRow("显示文字提示", "球上方那行小字（如「思考中」）", cfg.showTip, function (v) {
          save({ showTip: v });
        }),
        h("div", { style: sep }),
        presetRow,
        statusRow,
        h(
          "div",
          { style: hint },
          "双击球 = 隐藏/显示，Alt+B 同理。设置即时生效，不需要重启。"
        )
      );
    }

    // ── 挂载 ────────────────────────────────────────────────
    var handle = null;

    function apply(ctx) {
      function start() {
        try {
          handle = mount();
        } catch (e) {
          log("mount failed", e);
        }
        return function () {
          try {
            if (handle) handle.dispose();
          } catch (e) {}
          handle = null;
        };
      }
      if (ctx && typeof ctx.effect === "function") {
        ctx.effect(start, "aora-ball: mount");
      } else {
        start();
      }
      // 设置面板：可选注入，slots 不在也不影响球
      if (ctx && typeof ctx.inject === "function") {
        try {
          ctx.inject(["slots"], function (scope) {
            var slots = scope.get("slots");
            if (!slots) return;
            slots.inject("settings.plugins.tab", function () {
              return slots.register(
                {
                  name: "settings.plugins.tab",
                  id: "aora-ball",
                  order: 60,
                  label: function () {
                    return "表情球";
                  },
                },
                AoraSettingsPanel
              );
            });
          });
        } catch (e) {
          log("settings tab registration skipped", e);
        }
      }
    }

    exports.name = "dsh-aora-ball";
    exports.apply = apply;
    exports.inject = [];
    exports.AoraSettingsPanel = AoraSettingsPanel;
    return module.exports;
  },
});
