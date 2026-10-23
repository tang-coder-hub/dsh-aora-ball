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
      posMode: "corner",
      freeX: 0.78,
      freeY: 0.84,
      locked: false,
      gazeFollow: true,
      gazeStrength: 1.3,
      wander: true,
      hoverShy: true,
      sleepMin: 10,
    };

    var CORNERS = [
      { id: "br", label: "右下" },
      { id: "bl", label: "左下" },
      { id: "tr", label: "右上" },
      { id: "tl", label: "左上" },
    ];

    var GROUPS = [
      { key: "life", label: "生命周期", hint: "自己会到的状态" },
      { key: "emotion", label: "情绪反应", hint: "干活顺手/碰坑时的反应" },
      { key: "agent", label: "代理工作状态", hint: "DSH 事件直接驱动" },
    ];

    // 上游 emotion-ball 的完整 32 套（编号即对外契约，不可重排）
    var EMOTIONS = [
      { id: "00", label: "睡眠", g: "life" },
      { id: "01", label: "唤醒", g: "life" },
      { id: "02", label: "待机", g: "life" },
      { id: "03", label: "好奇", g: "life" },
      { id: "04", label: "发呆", g: "life" },
      { id: "05", label: "加载苏醒", g: "life" },
      { id: "06", label: "休眠", g: "life" },
      { id: "07", label: "抖动唤醒", g: "life" },
      { id: "10", label: "开心", g: "emotion" },
      { id: "11", label: "疑惑", g: "emotion" },
      { id: "12", label: "失落", g: "emotion" },
      { id: "13", label: "惊讶", g: "emotion" },
      { id: "14", label: "害羞", g: "emotion" },
      { id: "15", label: "疲惫", g: "emotion" },
      { id: "16", label: "专注", g: "emotion" },
      { id: "17", label: "慌张", g: "emotion" },
      { id: "18", label: "无奈", g: "emotion" },
      { id: "19", label: "满意", g: "emotion" },
      { id: "20", label: "困惑", g: "emotion" },
      { id: "21", label: "生气", g: "emotion" },
      { id: "30", label: "思考中", g: "agent" },
      { id: "31", label: "接收任务", g: "agent" },
      { id: "32", label: "处理中", g: "agent" },
      { id: "33", label: "完成", g: "agent" },
      { id: "34", label: "出错", g: "agent" },
      { id: "35", label: "等待输入", g: "agent" },
      { id: "36", label: "联网加载", g: "agent" },
      { id: "37", label: "复述回忆", g: "agent" },
      { id: "38", label: "拒绝受限", g: "agent" },
      { id: "39", label: "输出回复", g: "agent" },
      { id: "40", label: "检索资料", g: "agent" },
      { id: "41", label: "停止终止", g: "agent" },
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

    var CORNER_IDS = ["br", "bl", "tr", "tl"];

    /* 设置归一化：读写都走这里，避免两份校验逻辑漂移 */
    function normalize(s) {
      s.size = clampNum(s.size, 80, 280, BASE);
      s.margin = clampNum(s.margin, 0, 80, 18);
      if (CORNER_IDS.indexOf(s.corner) < 0) s.corner = "br";
      s.freeX = clampNum(s.freeX, 0, 1, 0.78);
      s.freeY = clampNum(s.freeY, 0, 1, 0.84);
      s.sleepMin = clampNum(s.sleepMin, 0, 60, 10);
      s.posMode = s.posMode === "free" ? "free" : "corner";
      s.hidden = !!s.hidden;
      s.follow = s.follow !== false;
      s.showTip = s.showTip !== false;
      s.locked = !!s.locked;
      s.gazeFollow = s.gazeFollow !== false;
      s.gazeStrength = clampNum(s.gazeStrength, 0.2, 3, 1.3);
      s.wander = s.wander !== false;
      s.hoverShy = s.hoverShy !== false;
      return s;
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
      return normalize(s);
    }

    function writeSettings(patch) {
      var s = readSettings();
      var k;
      if (patch) {
        for (k in patch) s[k] = patch[k];
      }
      s = normalize(s);
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

      var sleepAfterMs = cfg.sleepMin > 0 ? cfg.sleepMin * 60000 : 9e15;
      var ball = window.EmotionBall.create(stage, {
        emotion: "02",
        idle: { standbyAfter: 60000, sleepAfter: sleepAfterMs, standbyId: "02", sleepId: "00" },
        shape: "blob",
      });
      try {
        window.__aoraBall = ball;
      } catch (e) {}

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
        if (c.posMode === "free") {
          /* 自由模式：freeX/freeY 是球心在视口中的百分比，缩放锚点取中心 */
          var vw = window.innerWidth || 1280;
          var vh = window.innerHeight || 800;
          var half = BASE / 2;
          var cx = Math.max(0, Math.min(vw, c.freeX * vw));
          var cy = Math.max(0, Math.min(vh, c.freeY * vh));
          root.style.left = (cx - half) + "px";
          root.style.top = (cy - half) + "px";
          root.style.transformOrigin = "50% 50%";
        } else if (c.corner === "br") {
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

      // ── 鼠标注视 ──────────────────────────────────────────
      // 上游 setGaze 把幅度钉在 ±24/±15（viewBox 289）且会 clamp 入参，
      // 148px 显示下实际只有 6~12px 位移，几乎看不出来 —— 所以直接写 _gaze 目标值，
      // 幅度 × 强度。眼球跑到眼眶外前有 1.5 倍余量，默认 1.3 实测不越界。
      var gazeIdleAt = 0;
      var gazeHits = 0;
      var lastGX = 0;
      var lastGY = 0;
      var gazeCenter = null;
      var gazeCenterAt = 0;
      function applyGaze(nx, ny) {
        var st = clampNum(cfg.gazeStrength, 0.2, 3, 1.3);
        var cx = Math.max(-1, Math.min(1, nx));
        var cy = Math.max(-1, Math.min(1, ny));
        lastGX = cx;
        lastGY = cy;
        try {
          if (ball && ball._gaze) {
            ball._gaze.tx = cx * 24 * st;
            ball._gaze.ty = cy * 15 * st;
          } else if (ball && typeof ball.setGaze === "function") {
            ball.setGaze(cx, cy);
          }
        } catch (e) {}
      }
      function gaze(ev) {
        if (!ev || typeof ev.clientX !== "number") return;
        gazeHits += 1;
        if (!cfg.gazeFollow) return;
        /* 以球心为参照，而不是视口中心 —— 球在右下角时，以视口中心算出来的
           偏移永远偏向同一侧，看起来就像没在跟。除以短边 35% 当满幅，
           鼠标从球左边滑到右边就能看到眼珠左右看。 */
        var nowT = Date.now();
        if (!gazeCenter || nowT - gazeCenterAt > 150) {
          try {
            var rc = root.getBoundingClientRect();
            gazeCenter = { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 };
            gazeCenterAt = nowT;
          } catch (e) {
            gazeCenter = { x: (window.innerWidth || 1280) / 2, y: (window.innerHeight || 800) / 2 };
          }
        }
        var lim = Math.min(window.innerWidth || 1280, window.innerHeight || 800) * 0.35 || 280;
        applyGaze((ev.clientX - gazeCenter.x) / lim, (ev.clientY - gazeCenter.y) / lim);
        /* 只有真睡着/休眠才被鼠标「叫醒」，其余状态一律不动表情 ——
           之前每 450ms 就把表情重置回待机，过渡动画不断重播，看上去像注视卡住 */
        var nowMs = Date.now();
        if (nowMs - gazeIdleAt > 1200) {
          gazeIdleAt = nowMs;
          var cur = String((ball && ball.emotionId) || "");
          if (cur === "00" || cur === "06") {
            try { ball.setEmotion("01", { auto: true }); } catch (e) {}
            lastKey = "";
          }
        }
        if (gazeTimer) clearTimeout(gazeTimer);
        gazeTimer = setTimeout(function () {
          try { ball.setGaze(0, 0); } catch (e) {}
        }, 8000);
      }
      window.addEventListener("pointermove", gaze, { passive: true });
      // ── 状态轮询
      var lastKey = "";
      var busy = false;
      var gazeTimer = null;
      var alive = true;
      var mountAt = Date.now();
      var lastEventAt = Date.now();
      var wanderTimer = null;
      function apply(state) {
        busy = !!(state && state.emotionId && String(state.emotionId) !== "02");
        if (!cfg.follow) return;
        if (!state || !state.emotionId) return;
        var key = String(state.emotionId) + "|" + (state.tips || "");
        if (key === lastKey) return;
        lastKey = key;
        lastEventAt = Date.now();
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

      // ── 生命周期：加载苏醒 → 待机；空闲溜达；久战疲惫 ────
      try { ball.setEmotion("05", { auto: true }); } catch (e) {}
      setTimeout(function () {
        try { ball.setEmotion("02", { auto: true }); } catch (e) {}
      }, 1700);

      var wanderIds = ["02", "03", "04"];
      function scheduleWander() {
        if (wanderTimer) clearTimeout(wanderTimer);
        wanderTimer = setTimeout(function () {
          wanderTimer = null;
          try {
            var cur = String((ball && ball.emotionId) || "02");
            var idle = Date.now() - lastEventAt;
            if (cfg.wander && !busy && idle > 6000 && wanderIds.indexOf(cur) >= 0) {
              var pickId = wanderIds[Math.floor(Math.random() * wanderIds.length)];
              if (pickId !== cur) ball.setEmotion(pickId, { auto: true });
            }
          } catch (e) {}
          scheduleWander();
        }, 8000 + Math.random() * 8000);
      }
      scheduleWander();

      // 连续干活超 40 分钟且还在动 → 疲惫（每 40 分钟最多一次）
      var tiredAt = 0;
      setInterval(function () {
        var nowMs = Date.now();
        var working = nowMs - lastEventAt < 120000;
        if (cfg.follow && working && nowMs - mountAt > 2400000 && nowMs - tiredAt > 2400000) {
          tiredAt = nowMs;
          try { ball.setEmotion("15", { auto: true }); } catch (e) {}
        }
      }, 60000);

      // ── 自由拖动 + 固定位置 ───────────────────────────────
      var pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.title = "固定 / 解锁位置";
      pinBtn.style.cssText =
        "position:absolute;left:-1px;top:-1px;width:22px;height:22px;padding:0;border:0;border-radius:50%;" +
        "background:rgba(20,22,26,.55);color:#fff;font:11px/22px system-ui,sans-serif;text-align:center;" +
        "cursor:pointer;opacity:0;transition:opacity .18s ease;z-index:3;pointer-events:auto";
      root.appendChild(pinBtn);

      function updatePin(c) {
        pinBtn.textContent = c.locked ? "\uD83D\uDCCC" : "\uD83D\uDCCD";
        pinBtn.style.opacity = c.locked || pinBtn.__hover ? "1" : "0";
      }
      updatePin(cfg);

      pinBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        pinBtn.__hover = 1;
        writeSettings({ locked: !readSettings().locked });
      });

      // 鼠标在球上停留 3 秒 → 害羞（只是看一眼那种黏糊感，不抢工作状态）
      var shyTimer = null;
      stage.addEventListener("pointerenter", function () {
        pinBtn.__hover = 1;
        pinBtn.style.opacity = "1";
        if (!cfg.hoverShy) return;
        if (shyTimer) clearTimeout(shyTimer);
        shyTimer = setTimeout(function () {
          shyTimer = null;
          try {
            if (busy) return;
            var cur = String((ball && ball.emotionId) || "");
            if (cur === "00" || cur === "06" || cur === "05") return;
            ball.setEmotion("14", { auto: true });
            lastKey = "";
          } catch (e) {}
        }, 3000);
      });
      stage.addEventListener("pointerleave", function () {
        pinBtn.__hover = 0;
        updatePin(readSettings());
        if (shyTimer) { clearTimeout(shyTimer); shyTimer = null; }
      });

      var drag = null;
      stage.addEventListener("pointerdown", function (ev) {
        if (ev.button !== 0 || ev.target === pinBtn) return;
        if (readSettings().locked) return;
        var r = root.getBoundingClientRect();
        drag = {
          id: ev.pointerId,
          dx: ev.clientX - (r.left + r.width / 2),
          dy: ev.clientY - (r.top + r.height / 2),
          x0: ev.clientX,
          y0: ev.clientY,
          moved: 0,
        };
        try { stage.setPointerCapture(ev.pointerId); } catch (e) {}
      });
      stage.addEventListener("pointermove", function (ev) {
        if (!drag || ev.pointerId !== drag.id) return;
        if (Math.abs(ev.clientX - drag.x0) + Math.abs(ev.clientY - drag.y0) > 3) drag.moved = 1;
        if (!drag.moved) return;
        var vw = window.innerWidth || 1280;
        var vh = window.innerHeight || 800;
        var cx = Math.max(0, Math.min(vw, ev.clientX - drag.dx));
        var cy = Math.max(0, Math.min(vh, ev.clientY - drag.dy));
        cfg.posMode = "free";
        cfg.freeX = cx / vw;
        cfg.freeY = cy / vh;
        layout(cfg);
        ev.preventDefault();
      });
      function endDrag(ev) {
        if (!drag) return;
        var moved = drag.moved;
        try { stage.releasePointerCapture(drag.id); } catch (e) {}
        drag = null;
        if (moved) writeSettings({ posMode: "free", freeX: cfg.freeX, freeY: cfg.freeY });
      }
      stage.addEventListener("pointerup", endDrag);
      stage.addEventListener("pointercancel", endDrag);

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
        updatePin(cfg);
        if (!cfg.gazeFollow) {
          try { ball.clearGaze(); } catch (e) {}
        }
      }
      window.addEventListener(SET_EVENT, onSettings);
      window.addEventListener("resize", function () {
        layout(readSettings());
      });
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
          if (gazeTimer) clearTimeout(gazeTimer);
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

      // 表情墙：点哪个就试哪个，高亮跟服务端当前 id
      var triedState = react.useState("");
      var tried = triedState[0];
      var setTried = triedState[1];

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
      var modeBtn = function (id, label) {
        var active = cfg.posMode === id;
        return h(
          "button",
          {
            key: id,
            type: "button",
            style: Object.assign(
              {},
              btnStyle,
              active ? { borderColor: "rgba(120,170,255,.95)", color: "#7aa9ff" } : {}
            ),
            onClick: function () {
              save({ posMode: id });
            },
          },
          label
        );
      };

      var posRow = h(
        "div",
        { style: row },
        h(
          "div",
          null,
          h("div", null, "位置"),
          h("div", { style: subStyle }, "按住球直接拖到任意位置；也可以让它停靠在四角")
        ),
        h(
          "div",
          { style: { display: "flex", gap: "6px" } },
          modeBtn("corner", "四角停靠"),
          modeBtn("free", "自由拖动")
        )
      );

      var lockRow = toggleRow(
        "固定位置",
        "锁住当前位置，拖动不再生效（也可以点球左上角的图钉）",
        cfg.locked,
        function (v) {
          save({ locked: v });
        }
      );

      var gazeRow = toggleRow(
        "眼睛跟随鼠标",
        "没在干活时，目光跟着指针走；睡着或走神也会被叫回来",
        cfg.gazeFollow,
        function (v) {
          save({ gazeFollow: v });
        }
      );

      var strengthRow = h(
        "div",
        { style: row },
        h(
          "div",
          null,
          h("div", null, "注视强度"),
          h("div", { style: subStyle }, "上游幅度很含蓄（约 ±8% 球径），调大更明显；2 以上眼珠会顶到眼眶")
        ),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          h("input", {
            type: "range",
            min: "0.2",
            max: "3",
            step: "0.1",
            value: String(cfg.gazeStrength),
            onChange: function (e) {
              save({ gazeStrength: Number(e.target.value) });
            },
            style: { width: "120px" },
          }),
          h("span", { style: { minWidth: "36px", textAlign: "right" } }, Number(cfg.gazeStrength).toFixed(1) + "×")
        )
      );

      var wanderRow = toggleRow(
        "空闲时自己溜达",
        "没事干时在待机 / 好奇 / 发呆之间换着站，不傻站着",
        cfg.wander,
        function (v) {
          save({ wander: v });
        }
      );

      var sleepSel = h(
        "select",
        {
          value: String(cfg.sleepMin),
          onChange: function (e) {
            save({ sleepMin: Number(e.target.value) });
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
        [
          h("option", { key: "3", value: "3" }, "3 分钟"),
          h("option", { key: "10", value: "10" }, "10 分钟"),
          h("option", { key: "30", value: "30" }, "30 分钟"),
          h("option", { key: "0", value: "0" }, "不睡"),
        ]
      );

      var sleepRow = h(
        "div",
        { style: row },
        h(
          "div",
          null,
          h("div", null, "空闲多久去睡觉"),
          h("div", { style: subStyle }, "睡着后眼睛闭上，鼠标一动就醒（改了重启 DSH 生效）")
        ),
        sleepSel
      );
      var curId = String((svc && svc.state && svc.state.emotionId) || "");
      var wallRow = h(
        "div",
        { style: { padding: "4px 0 8px" } },
        h("div", null, "表情墙 · 全 32 个"),
        h("div", { style: subStyle }, "点一下球立刻变，不写回设置；蓝框 = 现在脸上的那个"),
        GROUPS.map(function (grp) {
          var list = EMOTIONS.filter(function (e) {
            return e.g === grp.key;
          });
          return h(
            "div",
            { key: grp.key, style: { marginTop: "10px" } },
            h(
              "div",
              { style: { fontSize: "11px", opacity: 0.62, marginBottom: "6px" } },
              grp.label + " · " + list.length + " 个 · " + grp.hint
            ),
            h(
              "div",
              { style: { display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: "6px" } },
              list.map(function (p) {
                var on = p.id === curId || p.id === tried;
                return h(
                  "button",
                  {
                    key: p.id,
                    type: "button",
                    title: p.id + " " + p.label,
                    style: Object.assign({}, btnStyle, {
                      padding: "6px 2px",
                      fontSize: "11px",
                      lineHeight: 1.15,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "1px",
                    }, on ? { borderColor: "rgba(120,170,255,.95)", color: "#7aa9ff" } : {}),
                    onClick: function () {
                      setTried(p.id);
                      pushEmotion(p.id, p.label);
                    },
                  },
                  h("span", { style: { opacity: 0.5, fontSize: "10px" } }, p.id),
                  h("span", null, p.label)
                );
              })
            )
          );
        })
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
        posRow,
        cfg.posMode === "corner" ? cornerRow : null,
        cfg.posMode === "corner" ? marginRow : null,
        lockRow,
        h("div", { style: sep }),
        toggleRow("跟随会话状态", "思考 / 调工具 / 出错 / 完成 自动换表情", cfg.follow, function (v) {
          save({ follow: v });
        }),
        toggleRow("显示文字提示", "球上方那行小字（如「思考中」）", cfg.showTip, function (v) {
          save({ showTip: v });
        }),
        gazeRow,
        strengthRow,
        wanderRow,
        sleepRow,
        h("div", { style: sep }),
        wallRow,
        statusRow,
        h(
          "div",
          { style: hint },
          "拖到任意位置后点图钉就能锁住；双击球 = 隐藏/显示，Alt+B 同理。设置即时生效。"
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
