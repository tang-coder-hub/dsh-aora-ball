# NOTICE

`client.js` 内联了第三方作品：**Emotion Ball（表情球）引擎**，
来自 [sam70361/aora-bot](https://github.com/sam70361/aora-bot) 的 `emotion-ball` 目录。

内联的四个源文件：`rings.js`、`emotions.js`、`ball.js`、`engine.js`，
构建时由 `build.mjs` 原样嵌入 `client.js`（各自 IIFE 包裹，只通过 `window` 通信）。

## 适用条款（以上游为准）

* **引擎源码与表情数据**：非商业用途免费；**商业用途需向上游作者取得授权**
  （见上游 `LICENSE` 与 `LICENSE-COMMERCIAL.md`）。
* **球形角色视觉形象**：**仅限个人技术学习与研究，禁止商业用途**
  （见上游 `NOTICE.md`）。

## 对本仓库的含义

* 本仓库的 MIT 许可（见 `LICENSE`）只覆盖插件自身代码，
  **不构成对上述第三方资产的再许可**；
* 若要商用，不能仅凭本仓库的 MIT 声明，必须另行取得上游授权；
* 上游更新引擎后，重跑 `node build.mjs` 即可同步（`build.mjs` 从本地 `aora/js/` 读源文件）。

## 插件自身代码

`index.js`（事件翻译 + 内置状态服务）、`client.tpl.js`（挂载、设置面板、轮询）、
`build.mjs`（内联构建）、`cordis.patch.yml`（bundle 声明）—— 均为本仓库原创，MIT。
